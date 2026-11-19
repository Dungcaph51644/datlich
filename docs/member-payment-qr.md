# QR cá nhân và thanh toán của người phụ trách

## Cài đặt

1. Trong Supabase SQL Editor, chạy toàn bộ [migration QR cá nhân](../supabase/migrations/202611190005_member_payment_qr.sql), sau [QR thanh toán](../supabase/migrations/202611190003_activity_payment_qr.sql) và các migration tài chính đã có. Migration mới có thể chạy lại, không sửa số tiền đã chốt hoặc tạo khoản thu.
2. Chạy `npm run build`, triển khai thư mục `dist` mới lên Netlify theo cách đang dùng.

Không cần API key, secret, Edge Function hoặc bucket mới. Tiếp tục dùng Supabase Storage `payment-qrs`. Chatbot đã ngừng sử dụng; không cần cài hay triển khai chatbot cho chức năng QR.

## Cách dùng

- Xác minh danh tính bằng mã cá nhân hoặc tài khoản đã liên kết, vào **Tiền sân & thanh toán → QR nhận tiền của [tên đã xác minh] → Tải QR cá nhân**.
- Chọn ảnh JPG/PNG/WebP tối đa 5 MB, xem trước và bấm **Lưu QR cá nhân**. Chỉ cần ảnh; không bắt nhập ngân hàng hay số tài khoản. Website không giải mã ảnh hoặc chứng thực chủ tài khoản; người chuyển kiểm tra thông tin người nhận trong ứng dụng ngân hàng sau khi quét.
- Mỗi thành viên có một QR hiện dùng. **Xem / thay QR** để thay ảnh hoặc xóa rồi Lưu. Việc thay/xóa chỉ có hiệu lực khi máy chủ lưu thành công; ảnh cũ vẫn dùng nếu upload/lưu lỗi. Lỗi bước lưu cho phép thử lại ảnh đã tải xong.
- Buổi mới và bảng phí chưa có cấu hình riêng tự dùng QR của người được giao phụ trách đặt sân. Bảng thanh toán có ảnh QR; bấm ảnh hoặc **Thanh toán** để xem số tiền cá nhân, phóng to, tải ảnh, sao chép số tiền và nội dung chuyển khoản.
- Các buổi/chuyến đã thiết lập QR hoặc tài khoản riêng vẫn giữ nguyên để tránh đổi nhầm người nhận. Người có quyền quản lý bấm **Dùng QR người phụ trách** để bỏ cấu hình riêng và dùng QR cá nhân. **Dùng QR riêng cho buổi** vẫn cho phép thiết lập ngoại lệ theo cách cũ.
- Chưa có QR thì hiển thị tên người phụ trách và thông báo cần bổ sung. Không tạo ngân hàng/số tài khoản giả từ ảnh. QR có thể chứa số tiền cố định: **Kiểm tra người nhận và nhập đúng số tiền trước khi chuyển**.

## Người phụ trách nào và tính tiền ra sao?

Người phụ trách là người được chỉ định cho bảng phí, nếu chưa chỉ định riêng thì là người được phân công của tất cả ca/sân trong bảng. Không lấy tên đang chọn hoặc trường “người thực tế đã đặt” thay cho phân công. Khi các ca/sân có nhiều người phụ trách hoặc còn ca chưa phân công, hệ thống không tự chọn người nhận: quản trị viên cần chỉ định một người phụ trách chung hoặc đặt QR riêng cho bảng đó.

Đối với **cầu lông**, phần tiền được phân bổ cho người phụ trách mặc định đã đủ, với nhãn **Mặc định · Người phụ trách đặt sân**. Họ vẫn chịu phần chi phí của mình; các thành viên khác không phải gánh thay. Phần mặc định không tạo dòng sổ thu, không tăng tiền quỹ và không được dùng làm căn cứ hoàn tiền. “Đã thu ròng” chỉ phản ánh tiền thực tế đã ghi nhận. Máy chủ chặn thu trùng phần của người phụ trách; hoàn tiền vẫn giới hạn bởi khoản thực thu còn lại. Các khoản thu cũ được giữ nguyên.

Số còn thiếu, bộ lọc trạng thái, Việc của tôi, tin nhắn chia tiền và CSV cùng áp dụng quy ước này. Khi chưa có chi phí/phân bổ thì vẫn hiển thị chưa xác định; tiền nháp luôn là tạm tính. Quy ước tự đủ chỉ áp dụng cho cầu lông; du lịch có thể dùng QR cá nhân nhưng vẫn xác nhận thanh toán thủ công.

Bảng nháp theo phân công hiện tại. Khi chốt tiền, hệ thống giữ lại người phụ trách nhận tiền tại thời điểm chốt; đổi phân công sau đó không âm thầm đổi QR hoặc trạng thái mặc định của bảng đã chốt. Muốn áp dụng phân công mới cho bảng cũ, người có quyền phải mở lại với lý do rồi chốt lại. Các số tiền và khoản thu cũ không bị sửa khi đổi QR cá nhân.

Các bảng đã chốt trước khi cài bản nâng cấp lấy người đang được phân công lúc cài đặt làm mốc, vì bản cũ chưa lưu riêng người nhận tại thời điểm chốt. Cần đối chiếu những bảng đã đổi phân công trước đó.

## Lưu trữ và đồng bộ

Máy chủ lấy thành viên từ danh tính đã xác minh, không nhận ID tùy chọn từ giao diện. Mỗi người chỉ lưu/thay/xóa QR cá nhân của mình; quản trị viên muốn đặt ngoại lệ cho người khác dùng cấu hình riêng của hoạt động. Chỉ nhận đường dẫn ảnh đã tải và xác nhận thuộc đúng người đó. Cấp quyền upload 15 phút, ảnh gốc bất biến, không ghi đè/xóa file dùng chung. Giới hạn 10 lần cấp upload mỗi 15 phút cho một thành viên.

Một hồ sơ QR đang dùng cho mỗi thành viên; ảnh cũ lưu lại để không làm hỏng liên kết đang mở. Ảnh dùng URL công khai ngẫu nhiên như chức năng QR trước, không có quyền liệt kê công khai; không đặt ảnh chứa thông tin không muốn chia sẻ với nhóm. Khách chưa xác minh không nhận QR/tài chính qua snapshot. Hồ sơ cá nhân chỉ trả cho chính danh tính đã xác minh; thành viên khác thấy QR đã được chọn cho hoạt động theo quyền xem tài chính hiện có.

Lưu hồ sơ tăng revision `booking_sync`, dùng kênh đồng bộ và đối soát 30 giây của dự án. Hai thiết bị sửa đồng thời bị chặn bằng phiên bản; biểu mẫu giữ ảnh để đối chiếu, bấm **Dùng bản mới** trước khi sửa tiếp. QR tự dùng không tạo cấu hình riêng hoặc tăng phiên bản bảng phí, nên không làm mất khả năng gộp các bảng tự tạo còn trống.

## Kiểm chứng và nghiệm thu

Kiểm thử tự động dùng PostgreSQL/PGlite và React: danh tính đã xác minh độc lập tên chọn, upload đúng chủ/metadata/hết hạn, upload một lần, QR không cần tài khoản, tạo buổi kế thừa, thay/xóa và đọc lại bằng danh tính khác, xung đột hai phiên, giữ cấu hình riêng cũ, mặc định thanh toán không tạo tiền giả/hoàn tiền giả, chống thu trùng, đổi phân công trước/sau chốt, du lịch giữ xác nhận thủ công, xuất dữ liệu/nhắc nợ nhất quán và migration chạy lại.

Đây là kiểm thử cục bộ, không phải upload ảnh hoặc chuyển tiền thật trên Supabase của nhóm. Sau khi cài SQL và triển khai, nghiệm thu trên hai thiết bị: A xác minh người phụ trách rồi lưu QR; B xác minh thành viên khác, mở buổi cũ chưa có ngoại lệ và buổi mới, thấy cùng ảnh; A thay/xóa, B nhận ảnh mới và tải lại vẫn đúng. Kiểm tra người phụ trách có nhãn mặc định, các thành viên khác chưa được tự đánh dấu; xem/tải QR không tạo sổ thu. Đối chiếu ảnh QR thật sau khi quét trong ứng dụng ngân hàng.
