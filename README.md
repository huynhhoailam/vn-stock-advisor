# VN Stock Advisor

Ứng dụng nghiên cứu chứng khoán Việt Nam chạy hoàn toàn trên frontend. Dữ liệu danh mục, lịch sử tín hiệu, paper trading và backtest được lưu cục bộ trong trình duyệt.

## Chạy ứng dụng

Mở PowerShell tại thư mục dự án:

```powershell
.\start-server.ps1
```

Sau đó truy cập `http://127.0.0.1:8765/`. Không nên mở trực tiếp bằng `file:///` vì một số trình duyệt hạn chế IndexedDB, tải file và CORS trong chế độ đó.

## Chức năng chính

- Market regime và quét cơ hội kỹ thuật.
- Kế hoạch vùng vào, dừng lỗ và mục tiêu.
- Lịch sử và đánh giá tín hiệu sau 5/10/20 phiên.
- Danh mục cá nhân, xuất/nhập sao lưu JSON.
- Paper trading có phí, thuế, trượt giá và quản trị vốn.
- Backtest từng mã hoặc nhiều mã, chống look-ahead.
- Phân tích tin tức nội bộ hoặc Gemini AI với liên kết kiểm tra HOSE/HNX.

Backtest và điểm kỹ thuật là công cụ nghiên cứu, không phải cam kết lợi nhuận hay lời khuyên đầu tư.
