// Sao lưu dữ liệu cá nhân lên Google Sheets, không cần backend.
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
const GOOGLE_OAUTH_CLIENT_ID = '699177608975-f5olqqts088ii1dhv6f5o9anp7bmm1hg.apps.googleusercontent.com';
const GOOGLE_SYNC_SHEET_KEY = 'vnStockGoogleSpreadsheetId';
const GOOGLE_SYNC_REVISION_KEY = 'vnStockGoogleRevision';
const GOOGLE_SYNC_DEVICE_KEY = 'vnStockGoogleDeviceId';
const GOOGLE_SYNC_FILE_NAME = 'VN Stock Advisor Backup';
let googleAccessToken = '';
let googleTokenClient = null;
let pendingGoogleConflict = null;

function getGoogleDeviceId() {
    let id = localStorage.getItem(GOOGLE_SYNC_DEVICE_KEY);
    if (!id) {
        id = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(GOOGLE_SYNC_DEVICE_KEY, id);
    }
    return id;
}

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
    await loadGoogleIdentity();
    googleAccessToken = await new Promise((resolve, reject) => {
        googleTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_OAUTH_CLIENT_ID,
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

async function googleDriveApi(path, options = {}) {
    if (!googleAccessToken) await connectGoogleSheets();
    const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) googleAccessToken = '';
    if (!response.ok) throw new Error(body?.error?.message || `Google Drive lỗi ${response.status}. Hãy bật Google Drive API cho project OAuth.`);
    return body;
}

const sheetCell = value => value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : value);
const rowsFor = (headers, rows) => [headers, ...rows.map(row => headers.map(key => sheetCell(row[key])))];

function backupSheetPayload(backup, syncMeta) {
    const json = JSON.stringify(backup);
    const chunks = json.match(/[\s\S]{1,40000}/g) || [''];
    return [
        { range: 'Portfolio!A1:G', values: rowsFor(['symbol', 'buyPrice', 'volume', 'stopLoss', 'initialStopLoss', 'target', 'updatedAt'], backup.portfolio) },
        { range: 'PaperAccount!A1:F', values: rowsFor(['id', 'initialCash', 'cash', 'realizedPL', 'positions', 'updatedAt'], backup.paperAccounts) },
        { range: 'PaperTrades!A1:L', values: rowsFor(['id', 'createdAt', 'side', 'symbol', 'volume', 'referencePrice', 'executionPrice', 'gross', 'fee', 'tax', 'realizedPL', 'remainingVolume'], backup.paperTrades) },
        { range: 'Signals!A1:L', values: rowsFor(['id', 'createdAt', 'sessionDate', 'symbol', 'price', 'score', 'signal', 'strategies', 'tradePlan', 'marketRegime', 'outcomes', 'updatedAt'], backup.signals) },
        { range: 'Backtests!A1:G', values: rowsFor(['id', 'createdAt', 'days', 'strategyFilter', 'symbols', 'summary', 'result'], backup.backtestRuns) },
        { range: 'Backup!A1:B', values: [['vn-stock-advisor backup', backup.exportedAt], ...chunks.map((chunk, index) => [index + 1, chunk])] },
        { range: 'SyncMeta!A1:F', values: [['revision', 'updatedAt', 'deviceId', 'backupHash', 'schemaVersion', 'app'], [syncMeta.revision, syncMeta.updatedAt, syncMeta.deviceId, syncMeta.backupHash, backup.schemaVersion, backup.app]] }
    ];
}

async function hashBackup(backup) {
    const stableData = { ...backup };
    delete stableData.exportedAt;
    const bytes = new TextEncoder().encode(JSON.stringify(stableData));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function ensureSyncMetaSheet(spreadsheetId) {
    const book = await googleApi(`spreadsheets/${spreadsheetId}?fields=sheets.properties.title`);
    if (book.sheets?.some(sheet => sheet.properties?.title === 'SyncMeta')) return;
    await googleApi(`spreadsheets/${spreadsheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'SyncMeta' } } }] }) });
}

async function discoverSpreadsheet() {
    const taggedQuery = encodeURIComponent("appProperties has { key='vnStockAdvisor' and value='backup' } and trashed=false");
    let result = await googleDriveApi(`files?q=${taggedQuery}&spaces=drive&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`);
    if (!result.files?.length) {
        const nameQuery = encodeURIComponent(`name='${GOOGLE_SYNC_FILE_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
        result = await googleDriveApi(`files?q=${nameQuery}&spaces=drive&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`);
    }
    return result.files?.[0]?.id || '';
}

async function tagSpreadsheetForDiscovery(spreadsheetId) {
    await googleDriveApi(`files/${encodeURIComponent(spreadsheetId)}?fields=id,appProperties`, {
        method: 'PATCH',
        body: JSON.stringify({ appProperties: { vnStockAdvisor: 'backup' } })
    });
}

async function ensureSpreadsheet() {
    let spreadsheetId = localStorage.getItem(GOOGLE_SYNC_SHEET_KEY);
    if (!spreadsheetId) spreadsheetId = await discoverSpreadsheet();
    if (spreadsheetId) {
        localStorage.setItem(GOOGLE_SYNC_SHEET_KEY, spreadsheetId);
        // Gắn metadata cả với Sheet được tạo từ phiên bản cũ để thiết bị mới tìm được qua Drive API.
        await tagSpreadsheetForDiscovery(spreadsheetId);
        await ensureSyncMetaSheet(spreadsheetId);
        return spreadsheetId;
    }
    const created = await googleApi('spreadsheets', {
        method: 'POST',
        body: JSON.stringify({ properties: { title: GOOGLE_SYNC_FILE_NAME }, sheets: ['Portfolio', 'PaperAccount', 'PaperTrades', 'Signals', 'Backtests', 'Backup', 'SyncMeta'].map(title => ({ properties: { title } })) })
    });
    spreadsheetId = created.spreadsheetId;
    await tagSpreadsheetForDiscovery(spreadsheetId);
    localStorage.setItem(GOOGLE_SYNC_SHEET_KEY, spreadsheetId);
    return spreadsheetId;
}

async function readRemoteMeta(spreadsheetId) {
    const result = await googleApi(`spreadsheets/${spreadsheetId}/values/SyncMeta!A2:F`);
    const row = result.values?.[0] || [];
    return { revision: Number(row[0]) || 0, updatedAt: row[1] || '', deviceId: row[2] || '', backupHash: row[3] || '', schemaVersion: Number(row[4]) || 0 };
}

async function readRemoteBackup(spreadsheetId) {
    const result = await googleApi(`spreadsheets/${spreadsheetId}/values/Backup!A2:B`);
    const json = (result.values || []).sort((a, b) => Number(a[0]) - Number(b[0])).map(row => row[1] || '').join('');
    if (!json) throw new Error('Sheet Backup không có dữ liệu.');
    const backup = JSON.parse(json);
    if (backup?.app !== 'vn-stock-advisor') throw new Error('Backup trên Google Sheets không đúng định dạng.');
    return backup;
}

async function writeGoogleBackup(spreadsheetId, backup, baseRevision) {
    // Đọc lại ngay trước khi ghi để thu hẹp cửa sổ tranh chấp giữa hai thiết bị.
    const latest = await readRemoteMeta(spreadsheetId);
    if (latest.revision !== baseRevision) throw new Error('Cloud vừa được thiết bị khác cập nhật. Hãy thử đồng bộ lại.');
    const syncMeta = { revision: latest.revision + 1, updatedAt: new Date().toISOString(), deviceId: getGoogleDeviceId(), backupHash: await hashBackup(backup) };
    const ranges = backupSheetPayload(backup, syncMeta);
    await googleApi(`spreadsheets/${spreadsheetId}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: ranges.map(item => item.range) }) });
    await googleApi(`spreadsheets/${spreadsheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: ranges }) });
    localStorage.setItem(GOOGLE_SYNC_REVISION_KEY, String(syncMeta.revision));
    localStorage.setItem('vnStockGoogleLastSync', syncMeta.updatedAt);
    hideGoogleConflict();
    googleSyncStatus(`Đã sao lưu phiên bản ${syncMeta.revision} lúc ${new Date(syncMeta.updatedAt).toLocaleString('vi-VN')}.`, 'ok');
    updateGoogleSyncControls();
}

async function syncToGoogleSheets() {
    googleSyncStatus('Đang chuẩn bị dữ liệu…');
    const backup = await buildLocalBackup();
    const spreadsheetId = await ensureSpreadsheet();
    const remote = await readRemoteMeta(spreadsheetId);
    const lastSeenRevision = Number(localStorage.getItem(GOOGLE_SYNC_REVISION_KEY)) || 0;
    if (remote.revision > lastSeenRevision && remote.deviceId !== getGoogleDeviceId()) {
        pendingGoogleConflict = { spreadsheetId, backup, remote };
        showGoogleConflict(remote);
        return;
    }
    await writeGoogleBackup(spreadsheetId, backup, remote.revision);
}

async function restoreFromGoogleSheets() {
    const spreadsheetId = localStorage.getItem(GOOGLE_SYNC_SHEET_KEY);
    if (!spreadsheetId) throw new Error('Chưa có Google Sheet được liên kết.');
    if (!confirm('Khôi phục sẽ ghi đè danh mục, đầu tư thử, tín hiệu và backtest trong trình duyệt. Tiếp tục?')) return;
    const remote = await readRemoteMeta(spreadsheetId);
    const backup = await readRemoteBackup(spreadsheetId);
    await exportLocalData();
    await restoreLocalBackup(backup);
    localStorage.setItem(GOOGLE_SYNC_REVISION_KEY, String(remote.revision));
    localStorage.setItem('vnStockGoogleLastSync', remote.updatedAt || new Date().toISOString());
    hideGoogleConflict();
    googleSyncStatus(`Đã khôi phục phiên bản ${remote.revision} từ Google Sheets.`, 'ok');
}

function showGoogleConflict(remote) {
    const panel = document.getElementById('google-sync-conflict');
    const detail = document.getElementById('google-conflict-detail');
    if (panel) panel.classList.remove('hidden');
    if (detail) detail.textContent = `Cloud có phiên bản ${remote.revision}, cập nhật ${remote.updatedAt ? new Date(remote.updatedAt).toLocaleString('vi-VN') : 'từ thiết bị khác'}.`;
    googleSyncStatus('Phát hiện dữ liệu được cập nhật trên thiết bị khác.', 'error');
}

function hideGoogleConflict() {
    document.getElementById('google-sync-conflict')?.classList.add('hidden');
    pendingGoogleConflict = null;
}

async function resolveGoogleConflictWithCloud() {
    if (!pendingGoogleConflict) return;
    const { spreadsheetId, remote } = pendingGoogleConflict;
    await exportLocalData();
    await restoreLocalBackup(await readRemoteBackup(spreadsheetId));
    localStorage.setItem(GOOGLE_SYNC_REVISION_KEY, String(remote.revision));
    localStorage.setItem('vnStockGoogleLastSync', remote.updatedAt || new Date().toISOString());
    hideGoogleConflict();
    googleSyncStatus(`Đã dùng dữ liệu cloud phiên bản ${remote.revision}; bản local cũ đã được tải xuống.`, 'ok');
}

async function resolveGoogleConflictWithLocal() {
    if (!pendingGoogleConflict) return;
    const { spreadsheetId, backup, remote } = pendingGoogleConflict;
    const cloudBackup = await readRemoteBackup(spreadsheetId);
    const blob = new Blob([JSON.stringify(cloudBackup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vn-stock-advisor-cloud-v${remote.revision}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await writeGoogleBackup(spreadsheetId, backup, remote.revision);
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
    const label = document.getElementById('google-connect-label');
    if (label) label.textContent = googleAccessToken ? 'Đã đăng nhập Google' : 'Đăng nhập với Google';
}

document.addEventListener('DOMContentLoaded', () => {
    localStorage.removeItem('vnStockGoogleClientId');
    updateGoogleSyncControls();
    document.getElementById('btn-google-connect')?.addEventListener('click', () => connectGoogleSheets().catch(error => googleSyncStatus(error.message, 'error')));
    document.getElementById('btn-google-sync')?.addEventListener('click', () => syncToGoogleSheets().catch(error => googleSyncStatus(error.message, 'error')));
    document.getElementById('btn-google-restore')?.addEventListener('click', () => restoreFromGoogleSheets().catch(error => googleSyncStatus(error.message, 'error')));
    document.getElementById('btn-google-use-cloud')?.addEventListener('click', () => resolveGoogleConflictWithCloud().catch(error => googleSyncStatus(error.message, 'error')));
    document.getElementById('btn-google-use-local')?.addEventListener('click', () => resolveGoogleConflictWithLocal().catch(error => googleSyncStatus(error.message, 'error')));
    document.getElementById('btn-google-conflict-cancel')?.addEventListener('click', hideGoogleConflict);
});
