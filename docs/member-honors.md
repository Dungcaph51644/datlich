# Huy hiệu vui và avatar

## Bật tính năng

1. Trong Supabase SQL Editor của dự án hiện tại, chạy toàn bộ [202611260001_member_honors.sql](../supabase/migrations/202611260001_member_honors.sql). Cần có các migration của dự án đã dùng trước đó, tối thiểu initial, quick_registration và booking_responsibility. Không chạy lại initial trên cơ sở dữ liệu đang dùng.
2. Để cho phép chọn ảnh từ thiết bị, chạy tiếp [202611260002_member_avatar_upload.sql](../supabase/migrations/202611260002_member_avatar_upload.sql). Nếu đã chạy bản 001 trước đây thì chỉ cần chạy bản 002 mới. Bản mới tự tạo bucket member-avatars và các quyền cần thiết; không phải tạo bucket bằng tay.
3. Build và triển khai mã website cùng thư mục [public/avatars](../public/avatars). Không cần API key, Edge Function hay secret mới.
4. Vào **Thành viên → Diện mạo & huy hiệu của tôi**. Thành viên phải xác minh bằng mã cá nhân hoặc tài khoản đã liên kết. Chọn tên đơn thuần không cho phép đổi diện mạo hoặc bỏ phiếu.
5. Tab **Diện mạo**: chọn avatar có sẵn hoặc **Chọn ảnh từ thiết bị**. Xem trước ảnh cắt vuông, rồi bấm **Lưu diện mạo**. Tab **Huy hiệu**: xem tiêu chí, tiến độ và chọn huy hiệu đã mở để ghim. Đổi tab giữ nguyên lựa chọn chưa lưu.
6. Mở trang trên thiết bị thứ hai hoặc tải lại để kiểm tra bản đã lưu. **Bỏ ảnh cá nhân** chuyển về chữ cái mặc định sau khi lưu; chọn avatar có sẵn cũng thay ảnh cá nhân. Đổi huy hiệu riêng không làm mất ảnh đã tải.

Nếu chưa chạy migration, trang vẫn hoạt động; khu vực huy hiệu báo chưa được bật và có nút tải lại. Không hiển thị huy hiệu giả khi truy vấn lỗi.

## Quy tắc huy hiệu

| Huy hiệu | Điều kiện |
| --- | --- |
| 🌱 Kèo đầu đời | Đăng ký Đi trong ít nhất 1 ngày đã kết thúc và trạng thái sân là Đã đặt |
| 🔥 Siêng chốt kèo | 5 ngày như trên |
| 👑 Lão làng chốt kèo | 20 ngày như trên |
| 🏸 Người giữ sân | Có ít nhất 1 ca/sân ghi nhận chính mình đã đặt thực tế, có thời điểm đặt và chưa hủy |
| 🛡️ Trụ cột giữ kèo | Có ít nhất 1 tuần được xác nhận hoàn thành phụ trách đặt sân |
| 🎭 Cây hài của tháng | Cuối tháng có ít nhất 3 phiếu và đứng cao nhất mục Cây hài |
| 💚 Đồng đội quốc dân | Cuối tháng có ít nhất 3 phiếu và đứng cao nhất mục Đồng đội dễ thương |

Một ngày có nhiều ca vẫn chỉ tính một ngày đăng ký. Dùng giờ kết thúc buổi và múi giờ Việt Nam để loại các buổi chưa kết thúc. Đây là dữ liệu đăng ký, **không phải điểm danh tại sân**. Sửa đăng ký, đổi lịch, hủy sân có thể thay đổi huy hiệu tự động; huy hiệu ghim không còn đủ điều kiện sẽ bị ẩn.

Mỗi danh tính xác minh được bỏ một phiếu/mục/tháng, được đổi hoặc rút phiếu, không tự bầu và không bầu người ngừng hoạt động. Bình chọn tháng hiện tại là tạm thời; chỉ tháng đã kết thúc mới tính huy hiệu, hòa cao nhất thì cùng nhận. Huy hiệu lưu trong bộ sưu tập nếu đã thắng ít nhất một tháng; hiển thị tháng gần nhất. Không cần tác vụ hẹn giờ. Phiếu ở tháng mới bắt đầu trống. Giao diện không công khai người đã bầu ai.

## Lưu và đồng bộ

Hai bảng mới nằm trong schema private; trình duyệt chỉ dùng ba RPC: get_member_hub, save_member_style, vote_member_honor. Máy chủ tự xác định người thao tác bằng cơ chế booking_actor hiện có; không nhận member_id từ giao diện để cấp quyền sửa.

Ghi diện mạo và phiếu dùng phiên bản mong đợi, cùng khóa đồng bộ đã có. Phiếu đã rút vẫn giữ phiên bản để chặn ghi lại từ thiết bị cũ. Sai tháng hoặc sai phiên bản bị từ chối; người dùng bấm **Dùng bản mới** rồi chọn lại. Thông báo lỗi giữ nguyên lựa chọn để thử lại. Thay đổi tăng booking_sync cho Realtime và cơ chế đối soát 30 giây hiện có; tải lại trang đọc từ máy chủ.

Avatar có sẵn chỉ dùng danh sách đường dẫn cục bộ đã cho phép. Ảnh cá nhân chỉ dùng đường dẫn avatars/UUID.jpg hoặc .webp thuộc bucket member-avatars của Supabase đã cấu hình. Không cho nhập URL/HTML tùy ý. Huy hiệu không cấp quyền quản trị, quyền đăng ký hay quyền thanh toán.

## Ảnh cá nhân từ thiết bị

- Nhận JPG, PNG, WebP tối đa 8 MB; HEIC/HEIF cần xuất sang định dạng được hỗ trợ. Kiểm tra chữ ký tệp, giải mã ảnh, giới hạn kích thước 16.000 px mỗi cạnh/40 triệu pixel, cắt vuông giữa ảnh và mã hóa lại 512 × 512 trước khi tải. Ảnh gốc và EXIF/vị trí không gửi lên máy chủ. File đã xử lý không quá 1 MB, WebP hoặc JPEG dự phòng.
- Máy chủ tự xác định người đang xác minh; không nhận member_id để cấp quyền. Giấy phép đường dẫn ngẫu nhiên dùng một lần trong 15 phút, tối đa 10 lần cấp trong cửa sổ này cho mỗi người. Storage chỉ cho chèn đúng đường dẫn đã được cấp và không cho người dùng ghi đè/xóa object.
- Sau khi Storage trả kết quả, RPC xác nhận kiểm tra đúng chủ ảnh, MIME và dung lượng. Lưu hồ sơ mới gắn ảnh đã xác nhận, cùng phiên bản mong đợi. Lỗi xác nhận hoặc lỗi lưu hồ sơ giữ lại lượt tải để thử lại, tránh tải lại file đã thành công. Nếu Storage đã nhận ảnh nhưng mất phản hồi, chỉ khôi phục khi backend xác nhận đúng object.
- Ảnh cá nhân hiển thị công khai như avatar trên website. Bỏ/thay avatar tách ảnh cũ khỏi hồ sơ; các object cũ có URL bất biến vẫn tồn tại trong Storage để tránh ảnh đang được xem bị ghi đè. Khi cần thu hồi hẳn ảnh cũ hoặc dọn ảnh bỏ dở, người quản lý xóa file trong Supabase Storage sau khi kiểm tra không còn hồ sơ dùng; không xóa riêng hàng storage.objects bằng SQL.
- Snapshot thông báo custom_avatars=true khi đã bật bản 002. Website mới vẫn dùng được bộ avatar có sẵn trên backend bản 001, đồng thời báo tải ảnh cá nhân đang chờ cập nhật. Realtime/đối soát dùng booking_sync hiện có.

## Nguồn ảnh và prompt

- [jerry-smirk.webp](../public/avatars/jerry-smirk.webp): ảnh Jerry do người dùng cung cấp, cắt vuông và tối ưu WebP.
- Ba avatar còn lại tạo bằng công cụ imagegen tích hợp, mỗi ảnh một prompt riêng. Bản dùng trên website là WebP 320 × 320; giữ ảnh gốc tại thư mục generated_images của phiên làm việc. Không gọi mô hình AI trong website.

### smug-cat

[Ảnh dùng trong website](../public/avatars/smug-cat.webp)

```text
Use case: illustration-story. Asset type: a single square funny avatar for a Vietnamese badminton friends club. Classic hand-drawn 2D cel-animation reaction-image aesthetic, warm slightly grainy painted texture, expressive cartoon eyes and rounded cheek shapes, thick warm dark outlines, nostalgic cartoon meme mood. Close-up head and shoulders centered, face fills 70% of square, eyes and mouth clearly readable at 48 pixels, ample safe space for circular cropping. A complete opaque square image with muted painted background, no words, no letters, no logos, no borders, no watermark. Funny and affectionate, not aggressive. Subject: a plump blue-gray cartoon cat with small rounded ears, half-lidded eyes, one eyebrow raised and a ridiculously smug closed-mouth crooked grin, cheeks puffed up like he has just delivered the worst badminton excuse. Muted sage green background.
```

### side-eye-duck

[Ảnh dùng trong website](../public/avatars/side-eye-duck.webp)

```text
Use case: illustration-story. Asset type: a single square funny avatar for a Vietnamese badminton friends club. Classic hand-drawn 2D cel-animation reaction-image aesthetic, warm slightly grainy painted texture, expressive cartoon eyes and rounded cheek shapes, thick warm dark outlines, nostalgic cartoon meme mood. Close-up head and shoulders centered, face fills 70% of square, eyes and mouth clearly readable at 48 pixels, ample safe space for circular cropping. A complete opaque square image with muted painted background, no words, no letters, no logos, no borders, no watermark. Funny and affectionate, not aggressive. Subject: a cream-yellow cartoon duck with an orange bill and an extremely suspicious side-eye, tilted head, one eyebrow raised, trying to look innocent after missing an easy badminton shot. Comically confident and sly, understated hilarious facial expression. Muted dusty peach background.
```

### cheeky-frog

[Ảnh dùng trong website](../public/avatars/cheeky-frog.webp)

```text
Use case: illustration-story. Asset type: a single square funny avatar for a Vietnamese badminton friends club. Classic hand-drawn 2D cel-animation reaction-image aesthetic, warm slightly grainy painted texture, expressive cartoon eyes and rounded cheek shapes, thick warm dark outlines, nostalgic cartoon meme mood. Close-up head and shoulders centered, face fills 70% of square, eyes and mouth clearly readable at 48 pixels, ample safe space for circular cropping. A complete opaque square image with muted painted background, no words, no letters, no logos, no borders, no watermark. Funny and affectionate, not aggressive. Subject: a chubby leaf-green cartoon frog with big round amber eyes, a wide mischievous toothy smirk, one tiny tongue tip peeking out, cheeks blushing, hilariously self-satisfied as if celebrating a lucky badminton point. Muted pale butter-yellow background.
```

## Kiểm chứng

- Kiểm tra tự động: [cơ sở dữ liệu](../tests/member-honors-database.test.ts), [giao diện](../tests/member-honors-ui.test.tsx), [tải ảnh và kiểm tra file](../tests/member-avatar-upload.test.ts), [kết nối và kiểm tra dữ liệu](../tests/member-honors-transport.test.ts).
- Cơ sở dữ liệu kiểm thử PostgreSQL/PGlite độc lập, không sửa dữ liệu thật. Bao gồm phân quyền, token hết hạn, nhiều thiết bị sửa cùng phiên bản, buổi tương lai/đã hủy/đổi đăng ký, nhiều ca một ngày, bình chọn tạm thời, tháng kết thúc, ngưỡng phiếu và đồng hạng.
- Cần kiểm tra trực tiếp sau triển khai: trên điện thoại A tải ảnh cá nhân và ghim huy hiệu, thiết bị B nhận thay đổi; B mở bản cũ rồi lưu phải thấy xung đột. Thử thay ảnh, bỏ ảnh và đổi huy hiệu nhưng giữ ảnh cá nhân. Kiểm tra chọn tên người khác không cho sửa diện mạo của họ. Kiểm tra hai tab và không tràn ngang ở 320/390 px.
- Chưa áp dụng migration lên Supabase thật, chưa kiểm chứng Realtime bằng hai thiết bị thật trong phiên làm việc này.

