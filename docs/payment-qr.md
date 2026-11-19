# QR chuyển khoản theo từng buổi và chuyến đi

## Bật trên Supabase

1. Sau các migration tài chính 003, tự tạo phí/ảnh bìa 004 và practical updates đang dùng, mở [migration QR thanh toán](../supabase/migrations/202611190003_activity_payment_qr.sql). Dán **toàn bộ** vào Supabase → SQL Editor và Run. Migration có thể chạy lại, không sửa số tiền, khoản thu hoặc bản chốt cũ.
2. Triển khai frontend mới lên Netlify (`npm run build`, triển khai `dist` theo cách đang dùng). Không cần Edge Function, API key AI hoặc secret mới cho QR.
3. Đăng nhập quản trị hoặc xác minh mã cá nhân của người phụ trách. Vào **Tiền sân / Du lịch → chọn hoạt động → Thêm QR & tài khoản**. Chọn ảnh JPG/PNG/WebP tối đa 5 MB, xem trước, nhập tên người nhận, ngân hàng, số tài khoản và bấm **Lưu QR & tài khoản**.

Ảnh được tải lên Supabase Storage và máy chủ xác nhận rồi mới gắn vào hoạt động. Trong lúc tải/lưu, các nút sửa bị khóa. Nếu lỗi, ảnh/tài khoản cũ tiếp tục phục vụ thành viên; biểu mẫu giữ nội dung để thử lại. Ảnh đã tải xong được dùng lại khi chỉ bước lưu thông tin bị lỗi.

## Sử dụng

- **Mỗi hoạt động có thông tin riêng.** Các nhóm ca/sân được gộp trong một bảng phí dùng QR của bảng phí đó. Buổi mới hoặc bản sao tuần mới không tự mang theo QR/tài khoản của tuần trước. Chọn **Dùng QR đã tải** để dùng lại ảnh và thông tin nhận tiền; kiểm tra lại trước khi lưu. Thư viện chung dành cho người đang có quyền quản lý hoạt động, tối đa 60 ảnh gần nhất.
- **Thay hoặc bỏ QR:** mở **Sửa QR & tài khoản**, chọn ảnh mới hoặc **Xóa QR khỏi buổi**, rồi Lưu. Bỏ QR giữ thông tin tài khoản và giữ ảnh trong thư viện để dùng lại. Không xóa tệp dùng chung khiến buổi/chuyến khác mất QR.
- **Thành viên thanh toán:** bấm **Thanh toán**. Tên đang chọn trên website được dùng để mở đúng dòng tiền; nếu không tìm thấy thì chọn tên trong cửa sổ. Khách đi cùng có dòng riêng. Số còn phải đóng bằng nghĩa vụ máy chủ trừ tiền đã thu ròng; tiền tạm tính được ghi rõ và có thể đổi. Thiếu chi phí/phân bổ thì hiển thị “Chưa xác định”, không suy đoán số tiền.
- **Sao chép và xem ảnh:** sao chép tài khoản giữ số 0 ở đầu; số tiền sao chép là đồng nguyên, không có dấu phân cách/đơn vị. Nội dung chuyển khoản mặc định gồm tên buổi và người đóng, hoặc dùng nội dung người phụ trách đã nhập. Phóng to 100–300%, cuộn ảnh lớn và tải ảnh gốc. Nếu ngân hàng cần nội dung riêng cho từng người, để trống nội dung chung để hệ thống thêm tên.
- Dưới ảnh luôn ghi **“Kiểm tra người nhận và nhập đúng số tiền trước khi chuyển”**. Ảnh có thể chứa số tiền cố định; website không sửa mã QR, không giả định số tiền bên trong khớp nghĩa vụ từng người. Người chuyển cần kiểm tra trong ứng dụng ngân hàng.
- **Xác nhận thủ công:** sau khi đối chiếu giao dịch, người phụ trách thu tiền/admin bấm **Đã thanh toán** ở dòng thành viên, đánh dấu đã kiểm tra nhận đủ và xác nhận. Máy chủ tính số còn thiếu, giữ chống ghi nhận trùng. Nếu thu một phần/dư/hoàn, tiếp tục dùng **Thu / hoàn**. Tên người nhận trên tài khoản là văn bản để đối chiếu; không tự cấp quyền quản lý cho người mang tên đó.
- Nếu chưa có QR hoặc ảnh tải lỗi, cửa sổ vẫn hiển thị tài khoản đã nhập và thông báo người phụ trách bổ sung/thử lại. Xem, phóng to, sao chép và tải QR không tạo khoản thu hoặc đánh dấu thanh toán.

## Lưu trữ, quyền và đồng bộ

Tận dụng client Supabase, RPC xác minh bằng Auth/mã cá nhân, `private.finance_access`, snapshot gộp và kênh `booking_sync` hiện có. Tài khoản/QR nằm trong `activity_payment_settings`, không lưu ảnh vào localStorage hoặc JSON. Chỉ danh tính đã xác minh được nhận thông tin này qua snapshot, theo quyền xem tài chính hiện tại; khách công khai không được đọc tài khoản hoặc sổ thu.

Bucket `payment-qrs` dùng liên kết ảnh công khai có đường dẫn ngẫu nhiên, giống cách phục vụ ảnh bìa: ai có chính xác liên kết ảnh đều có thể mở ảnh. Không có quyền liệt kê thư viện công khai. Upload cần quyền quản lý đang còn hiệu lực, đúng đường dẫn được cấp trong 15 phút; chỉ INSERT, không ghi đè hoặc xóa ảnh từ frontend. File được giới hạn JPG/PNG/WebP và 5 MB; client kiểm tra header, máy chủ kiểm tra metadata Storage trước khi dùng. Không chứa token cá nhân trong đường dẫn. Mỗi lần thay ảnh tạo đường dẫn mới nên thiết bị khác không nhận ảnh cũ từ cache.

Lưu tài khoản/QR có lịch sử và tăng revision; thiết bị khác nhận tín hiệu rồi đọc lại snapshot có quyền. Quay lại tab, nối mạng, kết nối lại Realtime và đối soát định kỳ 30 giây cũng lấy bản mới. Tải lại trang đọc từ máy chủ. Hai người cùng sửa được chặn bằng phiên bản riêng của thông tin nhận tiền; bản nhập giữ nguyên để chọn **Dùng bản mới** hoặc **Giữ phần tôi sửa**. Phí đã chốt, công nợ và khoản thu không đổi khi sửa QR.

## Kiểm chứng

- Kiểm thử PostgreSQL/PGlite: quyền admin/người phụ trách/thành viên/khách; đường dẫn upload một lần; MIME/dung lượng; file chưa tải hoặc metadata sai; sử dụng QR riêng, thay/dùng lại/bỏ ảnh; đọc bằng hai danh tính và snapshot mới; phiên bản cũ HTTP 409; đổi phụ trách; ảnh/quyền hết hạn; bản chốt và khoản thu không đổi; xác nhận thu chống trùng; migration chạy lại.
- Kiểm thử React và giao thức upload: xem trước trước khi lưu; chờ Storage xác nhận; lỗi và thử lại; dùng ảnh đã tải thành công sau lỗi lưu; giữ bản nhập khi xung đột; sao chép; chọn đúng tên; thiếu QR/chi phí và tiền dư; thay snapshot ở phiên đọc và tải lại. Sổ tiền chỉ đổi khi người có quyền xác nhận thủ công.
- Lượt chạy toàn bộ ngày 19/11/2026 đạt **241/241 kiểm thử**. Kiểm tra bố cục cửa sổ thanh toán trên trình duyệt ở 320/375/390/768/1440px: không tràn ngang, cỡ chữ trường nhập/chọn trên điện thoại 16px. Dữ liệu trình duyệt là dữ liệu kiểm thử riêng, các request tài chính/Storage được thay thế tại trang thử; không phải giao dịch hoặc upload lên Supabase thật.

**Cần nghiệm thu trên hai thiết bị thật sau khi chạy migration:** A là người phụ trách, B là thành viên đã xác minh. A tải QR, B mở cùng buổi/chuyến và nhận ảnh/tài khoản mới; B tải lại vẫn còn. A thay ảnh, B nhận đường dẫn mới; A bỏ ảnh, B còn tài khoản và thông báo thiếu QR. Dùng lại ảnh cho chuyến khác rồi bỏ ảnh ở buổi gốc: chuyến vẫn giữ QR. Hai phiên sửa đồng thời phải báo xung đột. B xem/tải QR không được đổi trạng thái thanh toán; A kiểm tra giao dịch rồi xác nhận, B mới thấy số đã đóng đổi. Kiểm tra trên Safari iPhone/Chrome Android bằng ảnh QR chuyển khoản thật và đối chiếu thông tin sau khi quét trong ứng dụng ngân hàng.

```sh
npm test
npm run build
```
