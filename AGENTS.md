# VN Stock Advisor — Hướng dẫn cho AI

## Mục tiêu sản phẩm

- Đây là công cụ nghiên cứu chứng khoán Việt Nam dùng cá nhân: tìm cơ hội, theo dõi danh mục, paper trading và backtest.
- Kết quả chỉ hỗ trợ ra quyết định, không được mô tả như lời khuyên tài chính hay cam kết lợi nhuận.
- Ưu tiên tính đúng, giải thích được, quản trị rủi ro và trải nghiệm mobile hơn số lượng tính năng.

## Ràng buộc kiến trúc

- Ứng dụng phải tiếp tục chạy frontend-only bằng HTML/CSS/JavaScript thuần; không tự ý thêm backend, framework hoặc bước build.
- Dữ liệu người dùng nằm trong `localStorage` và IndexedDB `vnStockAdvisorDB`; Google Sheets chỉ là bản sao lưu theo yêu cầu người dùng.
- Không lưu API key, OAuth access token, mật khẩu hoặc Client Secret lâu dài. OAuth Client ID là định danh công khai và có thể nằm trong source.
- Phải chạy ứng dụng qua HTTP khi kiểm thử OAuth/IndexedDB; `file://` không phải môi trường kiểm thử hợp lệ cho các tích hợp này.
- Không thêm dependency production nếu JavaScript trình duyệt chuẩn đáp ứng được yêu cầu.

## Quy tắc dữ liệu và bảo mật

- Không thay đổi tên database, object store, key path hoặc cấu trúc backup mà không có migration tương thích ngược.
- Import/restore phải kiểm tra định dạng và yêu cầu xác nhận trước khi ghi đè dữ liệu.
- Mọi URL hoặc nội dung tin tức bên ngoài phải được coi là dữ liệu không tin cậy; escape nội dung trước khi đưa vào HTML.
- Không đưa dữ liệu danh mục cá nhân ra dịch vụ ngoài nếu người dùng chưa chủ động thực hiện thao tác đồng bộ/phân tích.
- API ngoài có thể lỗi, CORS hoặc thay đổi schema; luôn có timeout, thông báo rõ ràng và fallback hợp lý.

## Quy tắc thuật toán

- `js/ta.js` là nguồn chuẩn cho chỉ báo, điểm cơ hội, điểm rủi ro thoát và trade plan.
- Không điều chỉnh trọng số hoặc ngưỡng chỉ vì vài ví dụ nhìn có vẻ tốt. Mọi thay đổi phải được kiểm tra trên nhiều mã/giai đoạn và ghi rõ giả thuyết.
- Tuyệt đối tránh look-ahead bias: tại thời điểm phát tín hiệu chỉ được dùng nến và benchmark đã xuất hiện.
- Backtest phải tính phí, thuế, trượt giá, sizing và không giả định thứ tự high/low trong cùng nến ngày.
- Không gộp điểm cơ hội mua và điểm rủi ro bán thành một đại lượng. Badge phải dùng ngôn ngữ hành động dễ hiểu.
- Dừng lỗ tự động trong danh mục chỉ được nâng lên theo hướng bảo vệ lợi nhuận, không tự động hạ xuống.
- Tin tức/AI là lớp bổ trợ; không được âm thầm thay thế tín hiệu định lượng hoặc tạo số liệu không có nguồn.

## UI và nội dung

- Thiết kế mobile-first; kiểm tra ở chiều rộng nhỏ và tránh dòng thông tin quá dài.
- Giá hiển thị cho người dùng là VNĐ; dữ liệu giá nội bộ từ nguồn thị trường hiện dùng đơn vị nghìn đồng và được nhân `1.000` khi format.
- Luôn phân biệt “giá hiện tại”, “hôm nay”, “giá vốn”, “dừng lỗ” và “mục tiêu”.
- Badge ưu tiên các cụm từ: `CÂN NHẮC MUA`, `THEO DÕI MUA`, `TIẾP TỤC GIỮ`, `CÂN NHẮC BÁN`, `ƯU TIÊN BÁN`.
- Giữ cảnh báo đây là công cụ nghiên cứu tại vị trí dễ nhìn.

## Quy trình thay đổi

1. Đọc `README.md`, `ARCHITECTURE.md` và phần liên quan trong `ALGORITHM.md`.
2. Tìm luồng hiện hữu và tái sử dụng helper trước khi thêm abstraction mới.
3. Giữ thay đổi nhỏ, tương thích dữ liệu cũ và không sửa ngoài phạm vi cần thiết.
4. Sau khi sửa JavaScript, chạy `node --check` cho file đã sửa và `node tests/algorithm-tests.js`.
5. Với thay đổi UI, chạy local server, kiểm tra console và xác nhận giao diện mobile.
6. Khi thay đổi hành vi, cập nhật tài liệu liên quan trong cùng lượt sửa.

## Tiêu chí hoàn thành

- Không có lỗi cú pháp hoặc lỗi console mới.
- Bộ test thuật toán đạt.
- Dữ liệu cũ vẫn đọc được và backup/restore không mất trường.
- Trạng thái loading, lỗi và dữ liệu rỗng có thông báo dễ hiểu.
- Không trình bày dữ liệu giả, kết quả chưa kiểm thử hoặc nguồn dự phòng như dữ liệu chắc chắn.

