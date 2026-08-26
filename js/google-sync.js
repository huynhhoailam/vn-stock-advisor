// Sao lưu dữ liệu cá nhân lên Google Sheets, không cần backend.
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GOOGLE_SYNC_CLIENT_KEY = 'vnStockGoogleClientId';
const GOOGLE_SYNC_SHEET_KEY = 'vnStockGoogleSpreadsheetId';
let googleAccessToken = '';
let googleTokenClient = null;

function googleSyncStatus(message, type = 'normal') {
    const element = document.getElementById('google-sync-status');
    if (!element) return;
    element.textContent = message;
    element.className = `text-[11px] ${type === 'error' ? 'text-red-400' : type === 'ok' ? 'text-green-400' : 'text-gray-400'}`;
}

function loadGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-google-identity]');
        if (existing) {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.dataset.googleIdentity = '1';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Không tải được Google Identity Services.'));
        document.head.appendChild(script);
    });
}

async function connectGoogleSheets() {
    if (location.protocol === 'file:') throw new Error('Google OAuth không hoạt động ổn định với file://. Hãy chạy start-server.ps1.');
    const clientId = document.getElementById('google-client-id')?.value.trim();
    if (!clientId || !clientId.endsWith('.apps.googleusercontent.com')) throw new Error('OAuth Client ID không hợp lệ.');
    localStorage.setItem(GOOGLE_SYNC_CLIENT_KEY, clientId);
    await loadGoogleIdentity();
    googleAccessToken = await new Promise((resolve, reject) => {
        googleTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: GOOGLE_SHEETS_SCOPE,
            callback: response => response.error ? reject(new Error(response.error_description || response.error)) : resolve(response.access_token),
            error_callback: error => reject(new Error(error?.message || 'Google OAuth bị hủy.'))
        });
        googleTokenClient.requestAccessToken({ prompt: googleAccessToken ? '' : 'consent' });
    });
    googleSyncStatus('Đã kết nối Google. Token chỉ được giữ trong phiên này.', 'ok');
    updateGoogleSyncControls();
}

async function googleApi(path, options = {}) {
    if (!googleAccessToken) await connectGoogleSheets();
    const response = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (response.status === 401) {
        googleAccessToken = '';
        throw new Error('Phiên Google đã hết hạn. Hãy kết nối lại.');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `Google Sheets lỗi ${response.status}.`);
    return body;
}

const sheetCell = value => value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : value);
const rowsFor = (headers, rows) => [headers, ...rows.map(row => headers.map(key => sheetCell(row[key])))];

function backupSheetPayload(backup) {
    const json = JSON.stringify(backup);
    const chunks = json.match(/[\s\S]{1,40000}/g) || [''];
    return [
        { range: 'Portfolio!A1:G', values: rowsFor(['symbol', 'buyPrice', 'volume', 'stopLoss', 'initialStopLoss', 'target', 'updatedAt'], backup.portfolio) },
        { range: 'PaperAccount!A1:F', values: rowsFor(['id', 'initialCash', 'cash', 'realizedPL', 'positions', 'updatedAt'], backup.paperAccounts) },
        { range: 'PaperTrades!A1:L', values: rowsFor(['id', 'createdAt', 'side', 'symbol', 'volume', 'referencePrice', 'executionPrice', 'gross', 'fee', 'tax', 'realizedPL', 'remainingVolume'], backup.paperTrades) },
        { range: 'Signals!A1:L', values: rowsFor(['id', 'createdAt', 'sessionDate', 'symbol', 'price', 'score', 'signal', 'strategies', 'tradePlan', 'marketRegime', 'outcomes', 'updatedAt'], backup.signals) },
        { range: 'Backtests!A1:G', values: rowsFor(['id', 'createdAt', 'days', 'strategyFilter', 'symbols', 'summary', 'result'], backup.backtestRuns) },
        { range: 'Backup!A1:B', values: [['vn-stock-advisor backup', backup.exportedAt], ...chunks.map((chunk, index) => [index + 1, chunk])] }
    ];
}

async function ensureSpreadsheet() {
    let spreadsheetId = localStorage.getItem(GOOGLE_SYNC_SHEET_KEY);
    if (spreadsheetId) return spreadsheetId;
    const created = await googleApi('spreadsheets', {
        method: 'POST',
        body: JSON.stringify({ properties: { title: 'VN Stock Advisor Backup' }, sheets: ['Portfolio', 'PaperAccount', 'PaperTrades', 'Signals', 'Backtests', 'Backup'].map(title => ({ properties: { title } })) })
    });
    spreadsheetId = created.spreadsheetId;
    localStorage.setItem(GOOGLE_SYNC_SHEET_KEY, spreadsheetId);
    return spreadsheetId;
}

async function syncToGoogleSheets() {
    googleSyncStatus('Đang chuẩn bị dữ liệu…');
    const backup = await buildLocalBackup();
    const spreadsheetId = await ensureSpreadsheet();
    const ranges = backupSheetPayload(backup);
    await googleApi(`spreadsheets/${spreadsheetId}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: ranges.map(item => item.range) }) });
    await googleApi(`spreadsheets/${spreadsheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: ranges }) });
    localStorage.setItem('vnStockGoogleLastSync', backup.exportedAt);
    googleSyncStatus(`Đã sao lưu lúc ${new Date(backup.exportedAt).toLocaleString('vi-VN')}.`, 'ok');
    updateGoogleSyncControls();
}

async function restoreFromGoogleSheets() {
    const spreadsheetId = localStorage.getItem(GOOGLE_SYNC_SHEET_KEY);
    if (!spreadsheetId) throw new Error('Chưa có Google Sheet được liên kết.');
    if (!confirm('Khôi phục sẽ ghi đè danh mục, đầu tư thử, tín hiệu và backtest trong trình duyệt. Tiếp tục?')) return;
    const result = await googleApi(`spreadsheets/${spreadsheetId}/values/Backup!A2:B`);
    const json = (result.values || []).sort((a, b) => Number(a[0]) - Number(b[0])).map(row => row[1] || '').join('');
    if (!json) throw new Error('Sheet Backup không có dữ liệu.');
    await restoreLocalBackup(JSON.parse(json));
    googleSyncStatus('Đã khôi phục dữ liệu từ Google Sheets.', 'ok');
}

function updateGoogleSyncControls() {
    const id = localStorage.getItem(GOOGLE_SYNC_SHEET_KEY);
    const link = document.getElementById('google-sheet-link');
    if (link) {
        link.classList.toggle('hidden', !id);
        if (id) link.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
    }
    const lastSync = localStorage.getItem('vnStockGoogleLastSync');
    if (lastSync && !googleAccessToken) googleSyncStatus(`Lần sao lưu gần nhất: ${new Date(lastSync).toLocaleString('vi-VN')}.`);
    const configured = Boolean(localStorage.getItem(GOOGLE_SYNC_CLIENT_KEY));
    const setup = document.getElementById('google-sync-setup');
    if (setup) setup.open = !configured;
    const label = document.getElementById('google-connect-label');
    if (label) label.textContent = googleAccessToken ? 'Đã đăng nhập Google' : 'Đăng nhập với Google';
}

document.addEventListener('DOMContentLoaded', () => {
    const clientInput = document.getElementById('google-client-id');
    if (clientInput) clientInput.value = localStorage.getItem(GOOGLE_SYNC_CLIENT_KEY) || '';
    updateGoogleSyncControls();
    document.getElementById('btn-google-connect')?.addEventListener('click', () => connectGoogleSheets().catch(error => googleSyncStatus(error.message, 'error')));
    document.getElementById('btn-google-sync')?.addEventListener('click', () => syncToGoogleSheets().catch(error => googleSyncStatus(error.message, 'error')));
    document.getElementById('btn-google-restore')?.addEventListener('click', () => restoreFromGoogleSheets().catch(error => googleSyncStatus(error.message, 'error')));
});
