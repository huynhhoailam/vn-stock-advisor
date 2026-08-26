# Kiến trúc VN Stock Advisor

## Tổng quan

Ứng dụng là một static web app không có backend và không có bước build. `index.html` nạp CSS cùng các file JavaScript theo thứ tự phụ thuộc. Các hàm được chia sẻ qua phạm vi global của trình duyệt.

```text
Nguồn dữ liệu thị trường
        ↓
js/data.js → OHLCV/realtime/cache
        ↓
js/ta.js → chỉ báo, chiến lược, điểm và trade plan
        ↓
js/app.js → điều phối tab, scanner, biểu đồ và chi tiết mã
        ├─ js/portfolio.js → danh mục + backup JSON
        ├─ js/paper-trading.js → giao dịch mô phỏng
        ├─ js/backtest.js → walk-forward backtest
        ├─ js/signal-store.js → lịch sử/đánh giá tín hiệu
        ├─ js/ai-news.js → tin tức và phân tích AI tùy chọn
        └─ js/google-sync.js → sao lưu/khôi phục Google Sheets
```

## Vai trò từng file

- `index.html`: cấu trúc các tab, modal và thứ tự tải script.
- `css/style.css`: giao diện bổ sung trên Tailwind CDN, breakpoint mobile và badge.
- `js/data.js`: danh sách mã HOSE, snapshot VPS, lịch sử VNDirect, cache và fallback.
- `js/ta.js`: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, market regime, strategy detection và `evaluateStock`.
- `js/app.js`: khởi tạo ứng dụng, quét thị trường, render kết quả, autocomplete và biểu đồ.
- `js/portfolio.js`: danh mục trong localStorage, render kế hoạch quản trị vị thế, export/import backup.
- `js/paper-trading.js`: tài khoản thử, vị thế, giao dịch, phí/thuế/trượt giá và sizing theo rủi ro.
- `js/backtest.js`: mô phỏng walk-forward và tổng hợp kết quả nhiều mã.
- `js/signal-store.js`: schema IndexedDB, lưu tín hiệu mua và cập nhật outcome 5/10/20 phiên.
- `js/ai-news.js`: lấy tin, kiểm tra nguồn và Gemini tùy chọn; lỗi AI không được chặn phân tích kỹ thuật.
- `js/google-sync.js`: Google Identity Services, Sheets API và backup đầy đủ.

## Lưu trữ

### localStorage

- `vnStockPortfolio`: danh mục đang nắm giữ.
- `vnStockGoogleSpreadsheetId`: Google Sheet đã liên kết.
- `vnStockGoogleLastSync`: lần sao lưu Google gần nhất.
- Một số cờ UI không nhạy cảm như trạng thái hướng dẫn AI.

### sessionStorage

- Gemini API key chỉ sống trong tab hiện tại.

### IndexedDB

Database `vnStockAdvisorDB`, version hiện tại là `3`:

- `signals`, key `id`: tín hiệu mua và outcome.
- `paperAccounts`, key `id`: tài khoản paper trading.
- `paperTrades`, key tự tăng: lịch sử lệnh thử.
- `backtestRuns`, key tự tăng: kết quả backtest đã lưu.

Khi nâng version phải tạo store/index trong `onupgradeneeded` và giữ khả năng đọc dữ liệu version cũ.

## Sao lưu Google Sheets

Luồng hiện tại là đồng bộ một chiều có chủ đích:

1. Người dùng đăng nhập Google và cấp scope Sheets.
2. Ứng dụng dùng Drive API (`drive.file`) để tìm lại spreadsheet `VN Stock Advisor Backup` do chính ứng dụng tạo trên thiết bị khác.
3. Các sheet `Portfolio`, `PaperAccount`, `PaperTrades`, `Signals`, `Backtests` phục vụ việc đọc.
4. Sheet `Backup` chứa JSON chia nhỏ thành các cell để khôi phục chính xác.
5. `SyncMeta` lưu revision, thời điểm, device ID và hash của backup.
6. Trước khi ghi, ứng dụng so revision cloud với revision thiết bị đã thấy; khi lệch sẽ chặn ghi và yêu cầu chọn dữ liệu.
7. Khôi phục hoặc cưỡng chế ghi đè luôn tải bản JSON của phía bị thay thế trước.

OAuth access token chỉ nằm trong biến JavaScript và mất khi tải lại trang. Client Secret không tồn tại trong ứng dụng.

## Nguyên tắc mở rộng

- Thêm dữ liệu mới vào `buildLocalBackup()` và `restoreLocalBackup()` cùng lúc.
- Tính toán thuần nên đặt trong `js/ta.js` để test được bằng Node.
- Code gọi mạng thuộc `data.js` hoặc module tích hợp riêng; UI không gọi trực tiếp API nếu đã có data helper.
- Tránh circular dependency giữa các script global. Nếu thêm module mới, kiểm tra thứ tự `<script>` trong `index.html`.
