# Thuật toán gợi ý và kiểm thử

Tài liệu này mô tả hành vi hiện tại. Source trong `js/ta.js` và `js/backtest.js` vẫn là nguồn sự thật khi có khác biệt.

## Dữ liệu đầu vào

- Nến ngày OHLCV của từng mã.
- Snapshot thanh khoản/giá từ VPS khi khả dụng.
- VN-INDEX làm benchmark đánh giá trạng thái thị trường.
- Tối thiểu khoảng 50–60 nến cho các phép đánh giá đầy đủ.

API và dữ liệu realtime có thể thiếu hoặc trễ. Thuật toán phải trả trạng thái thiếu dữ liệu thay vì tự suy đoán giá trị.

## Chỉ báo

- SMA 10/20/50 cho cấu trúc xu hướng.
- RSI 14 theo Wilder smoothing.
- MACD 12/26/9 và histogram.
- Bollinger Bands 20 phiên, độ lệch chuẩn 2.
- ATR 14 cho khoảng dừng lỗ theo biến động.
- Khối lượng hiện tại so với trung bình 20 phiên trước.
- Mẫu nến và vị trí so với vùng giá gần đây.

## Chiến lược được nhận diện

- `BOTTOM`: thăm dò vùng giá thấp khi có dấu hiệu ổn định/xác nhận.
- `MONEY_FLOW`: dòng tiền và động lượng tăng kèm khối lượng.
- `LEADER`: xu hướng mạnh, cấu trúc MA và động lượng phù hợp.
- `BB_BREAKOUT`: phá dải trên Bollinger kèm điều kiện xác nhận.

Một chiến lược được phát hiện không đồng nghĩa tự động mua; kết quả còn chịu điểm tổng hợp, độ giãn giá, thanh khoản và market regime.

## Điểm cơ hội

`evaluateStock()` tổng hợp điểm từ:

- Vị trí giá so với SMA và cấu trúc xu hướng.
- RSI và MACD.
- Thanh khoản/khối lượng xác nhận.
- Chất lượng setup và breakout.
- Sức mạnh tương đối so với benchmark khi có dữ liệu.
- Cờ rủi ro như quá giãn, thanh khoản mỏng hoặc động lượng chưa xác nhận.
- Điều chỉnh market regime.

Điểm cuối được làm tròn và chặn trong `[0, 100]`. Ngưỡng hiện tại:

- `82`: ứng viên mạnh, nhưng chỉ thành `STRONG_BUY` khi qua điều kiện chất lượng và thị trường.
- `66`: vùng cân nhắc/theo dõi mua khi có setup hợp lệ.
- `48`: ranh giới trung tính; dưới ngưỡng không được coi là hấp dẫn.

Badge không được suy ra chỉ từ điểm. Ví dụ điểm cao nhưng giá quá giãn phải chuyển thành chờ điểm vào.

## Điểm rủi ro thoát

Điểm `exitRisk.score` độc lập với điểm cơ hội. Nó tăng khi có các tín hiệu như thủng cấu trúc, MACD suy yếu, mất hỗ trợ, áp lực giá/khối lượng hoặc thị trường xấu.

- `>= 70`: `ƯU TIÊN BÁN`.
- `>= 50`: `CÂN NHẮC BÁN`.
- Thủng dừng lỗ có thể ưu tiên hành động dù các chỉ báo khác chưa đồng thuận.

Không hiển thị điểm cơ hội như lý do bán và không hiển thị điểm rủi ro như cơ hội mua.

## Market regime

VN-INDEX được phân loại dựa trên giá, SMA20, SMA50 và RSI:

- `BULL`: cộng điểm cho setup thuận xu hướng.
- `NEUTRAL`: không điều chỉnh hoặc điều chỉnh nhẹ.
- `BEAR`: giảm điểm và hạn chế mua; setup bắt đáy chỉ được giảm phạt một phần, không được coi là an toàn.

“Thị trường rủi ro: -8 điểm” nghĩa là điểm cơ hội của mã bị giảm bởi môi trường thị trường, không có nghĩa giá chắc chắn giảm 8%.

## Kế hoạch giao dịch

`buildTradePlan()` tạo:

- Vùng vào quanh giá hiện tại, hẹp hoặc rộng tùy setup bắt đáy.
- Dừng lỗ là giá trị bảo vệ chặt nhất trong ba nhóm: đáy cấu trúc, mức rủi ro tối đa và ATR.
- Mục tiêu 1 ở `1.5R`, mục tiêu 2 ở `2.5R`.
- Trạng thái hành động và ghi chú không mua đuổi.

Với danh mục đã nắm giữ, dừng lỗ gợi ý có thể nâng theo giá nhưng không tự hạ xuống. Người dùng vẫn chịu trách nhiệm kiểm tra gap, thanh khoản và sự kiện doanh nghiệp.

## Backtest

Backtest dùng walk-forward:

- Tại mỗi ngày tín hiệu chỉ truyền `candles.slice(0, signalIndex + 1)` vào thuật toán.
- Benchmark cũng bị cắt tại đúng thời điểm tín hiệu.
- Chờ tối đa ba phiên để giá đi vào vùng mua.
- Không dùng high/low của chính nến khớp lệnh để quyết định stop/target.
- Sau khi đạt 1R, stop hòa vốn chỉ có hiệu lực từ phiên kế tiếp.
- Mỗi lệnh rủi ro tối đa khoảng 1% tài khoản và tỷ trọng tối đa 25%.
- Tính phí mua/bán, thuế bán và trượt giá.
- Một vị thế giữ tối đa 20 phiên trong mô hình hiện tại.

Các chỉ số chính gồm tổng lợi nhuận danh mục, tỷ lệ thắng, lợi nhuận trung bình, max drawdown và profit factor. Không kết luận thuật toán hiệu quả khi số lệnh quá ít hoặc chỉ kiểm tra một mã/giai đoạn.

## Quy tắc đánh giá thay đổi

Khi sửa trọng số/ngưỡng:

1. Ghi giả thuyết và hành vi mong muốn.
2. Chạy unit test trong `tests/algorithm-tests.js`.
3. Backtest nhiều mã thanh khoản, nhiều market regime và giai đoạn khác nhau.
4. So sánh số lệnh, lợi nhuận, drawdown, profit factor và độ ổn định; không tối ưu riêng tỷ lệ thắng.
5. Kiểm tra riêng breakout, trend và bottom; tránh để một setup thống trị toàn bộ kết quả.
6. Sau cùng mới paper trade để kiểm chứng dữ liệu và độ trượt thực tế.

