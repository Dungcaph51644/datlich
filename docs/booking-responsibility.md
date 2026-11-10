# Người phụ trách đặt sân (CS)

## Bật trên Supabase hiện tại

Không cần thêm biến môi trường, service-role key, SMTP hoặc bật đăng nhập ẩn danh. Website tiếp tục dùng URL và publishable/anon key hiện có. Quản trị viên dùng quyền Supabase Auth đang có; thành viên dùng mã xác minh cá nhân.

1. Mở dự án Supabase → **SQL Editor → New query**.
2. Mở và sao chép **toàn bộ** [migration CS](../supabase/migrations/202611100002_booking_responsibility.sql), rồi bấm **Run**. File này chạy sau hai migration cũ; dự án đang dùng đăng ký nhanh đã có hai bản đó. Giữ cả `begin`, khối `REALTIME` và `commit` ở cuối file.
3. Tải lại website, mở **Phân công CS**. Trang chủ sẽ có phụ trách tuần này và tuần sau. Kiểm tra bằng terminal:

   ```sh
   npm run check:connection
   ```

   Lệnh này phân biệt: đăng ký nhanh kết nối được, phân công CS đã bật hay chưa, lịch khởi tạo có vướng tên thành viên hay không và publication Realtime đã bật hay chưa. API hoạt động không thay thế kiểm thử hai trình duyệt.

4. Đăng nhập quản trị bằng biểu tượng khiên hoặc menu. Nếu chưa cấp quyền admin, làm theo mục đăng nhập quản trị trong [README](../README.md).
5. Trong **Phân công CS → Vòng phân công**, bấm **Cấp mã cá nhân** cạnh đúng thành viên. Kiểm tra mã thành viên khi trùng tên; gửi riêng mã cho đúng người bằng cách liên lạc hiện có của nhóm. Website không tự gửi Zalo.
6. Thành viên bấm **Nhập mã**, dán mã một lần. Mã có hiệu lực 7 ngày và chỉ dùng một lần; phiên thiết bị có hiệu lực 180 ngày. Mỗi thiết bị mới cần mã mới. Khi cấp mã, admin có thể chọn thu hồi tất cả thiết bị cũ của người đó. Thành viên ngừng hoạt động bị thu hồi các phiên này.

Chọn tên để đăng ký đánh cầu **không xác minh quyền đặt sân**. Đổi lượt, xử lý thông báo và cập nhật sân sử dụng danh tính đã được máy chủ xác minh, hiển thị rõ trên màn hình. Đổi tên đang chọn không đổi danh tính này. Nếu đang đăng nhập Supabase Auth có liên kết thành viên, danh tính Auth được ưu tiên; muốn thử thành viên khác, dùng phiên trình duyệt độc lập đã đăng xuất quản trị.

Migration có thể chạy lại. Các tuần đã có, danh sách đủ điều kiện đã sửa và lịch sử ban đầu đã nhập không bị ghi đè. Khởi tạo chỉ diễn ra trong migration hoặc lệnh quản trị rõ ràng, không diễn ra mỗi lần mở ứng dụng.

## Lịch khởi tạo và liên kết thành viên

Tuần bắt đầu thứ Hai và kết thúc Chủ nhật theo giờ Việt Nam; cả hai ngày được lưu trong database (`week_end` là cột generated stored từ `week_start + 6`). Liên kết bằng ID thành viên. Bảy tuần đã thống nhất được giữ đúng:

| Khoảng tuần      | Phụ trách   |
| ---------------- | ----------- |
| 09–15/11/2026    | Yến         |
| 16–22/11/2026    | Nguyên      |
| 23–29/11/2026    | Newbie Long |
| 30/11–06/12/2026 | Ái          |
| 07–13/12/2026    | Trường      |
| 14–20/12/2026    | Mỹ Linh     |
| 21–27/12/2026    | Chi         |

Nếu không tìm thấy một trong 11 tên hoặc có nhiều kết quả, không tự tạo danh tính hay đoán ID. Trang phân công báo từng tên cần xử lý; admin bấm **Liên kết đúng thành viên**, kiểm tra tên/mã và chọn ID đang có. Chỉ khởi tạo phần còn thiếu khi các liên kết rõ ràng. Không ghi đè phân công hiện có.

Vòng mặc định theo thứ tự: Dũng, Trường, Hiền, Quyết, Yến, Chi, Nguyên, Khôi, Newbie Long, Mỹ Linh, Ái. Các thành viên khác vẫn đăng ký đánh cầu bình thường; không tự được thêm vào vòng. Admin điều chỉnh điều kiện và thứ tự trong **Vòng phân công**. Ngừng hoạt động không tự chuyển các tuần đã chốt sang người khác; admin cần xử lý các tuần còn giao cho người đó.

## Lịch sử và đề xuất công bằng

Tất cả lịch sử ban đầu bắt đầu ở trạng thái **Chưa có lịch sử ghi nhận**, không mặc định 0 lượt. Trước khi đề xuất, admin mở **Lịch sử & điều kiện** cho từng người đủ điều kiện:

- Nhập tổng số lượt đã hoàn thành đến một Chủ nhật trong quá khứ và tuần gần nhất nếu biết.
- Chọn trạng thái **Đã kiểm tra và xác nhận số lượt ban đầu**. Chỉ nhập 0 khi đã xác nhận người đó chưa từng phụ trách đến mốc này.
- Có thể nhập từng tuần trong quá khứ bằng **Phân công / nhập lịch sử**, chọn người và xác nhận hoàn thành. Một tuần có nhiều buổi vẫn chỉ tính một lượt.
- Những tuần đã nằm trong tổng ban đầu không được cộng lại lần nữa. Lịch sử chi tiết vẫn được giữ để xem.
- Nếu đã có số lượt nhưng không biết tuần gần nhất, thuật toán ghi rõ thiếu mốc, không coi là chưa từng phụ trách; khi hòa điểm, người có mốc rõ ràng được xét trước nhóm thiếu mốc.

Admin bấm **Đề xuất lịch phân công**, chọn thứ Hai và 1–26 tuần. Máy chủ chỉ chọn người hoạt động/đủ điều kiện/lịch sử đã xác nhận; xếp theo tổng lượt đã hoàn thành cộng các lượt tương lai đã chốt và các lượt mới trong cùng bản đề xuất. Hòa điểm xét lần phụ trách gần nhất rồi thứ tự cố định; tránh người của tuần liền trước khi còn người khác. Các tuần đã chốt được hiển thị và giữ nguyên.

Bản đề xuất giải thích mỗi lựa chọn. Admin có thể đổi người trong bản xem trước, nhập lý do rồi bấm **Áp dụng**. Nếu dữ liệu đã thay đổi kể từ lúc đề xuất, máy chủ yêu cầu tạo lại; không ghi đè lịch mới. Toàn bộ các tuần mới được áp dụng trong một giao dịch. Thêm người, sửa lịch sử hoặc thay điều kiện không tự chạy lại việc phân công.

Hoàn thành tuần là xác nhận riêng sau khi tuần kết thúc, do người phụ trách đã xác minh hoặc admin thực hiện. Không tự suy ra hoàn thành từ trạng thái Đã đặt, Đi hoặc Không đi. Nếu sửa người phụ trách của một tuần đã hoàn thành, danh tính người thực sự đã hoàn thành vẫn giữ nguyên. Khi cần sửa một lịch sử nhập sai, admin bỏ xác nhận hoàn thành với lý do, điều chỉnh người, rồi xác nhận lại; các bước đều được ghi lại.

## Đổi lượt

1. Người tuần A trao đổi với người tuần B kế tiếp, rồi bấm **Đề nghị đổi lượt** từ phân công của mình.
2. Xem đúng hai người và hai khoảng tuần, nhập lý do nếu có, gửi yêu cầu. Phân công chưa thay đổi.
3. Người B thấy yêu cầu và thông báo trong website; chọn **Đồng ý đổi lượt** hoặc **Từ chối**. Chỉ B đã xác minh mới được quyết định; admin không xác nhận thay bằng nút này.
4. Khi đồng ý, máy chủ kiểm tra lại người, phiên bản, hai tuần liền nhau và thời hạn rồi đổi cả hai tuần trong một giao dịch. Lỗi ở bất kỳ bước nào hoàn tác cả hai tuần, thông báo và lịch sử liên quan.
5. Người gửi được hủy yêu cầu đang chờ. Không cho yêu cầu chồng lên một phân công đang có yêu cầu khác; không đổi với chính mình, tuần đã kết thúc hoặc chấp nhận lại yêu cầu cũ.
6. Nếu admin hoặc một yêu cầu khác đã sửa phân công, yêu cầu cũ chuyển **Không còn hiệu lực**. Nếu tuần kế tiếp chưa phân công, giao diện hướng dẫn liên hệ admin.
7. Admin có nút **Đổi trực tiếp** để xử lý ngoại lệ. Bắt buộc lý do và kiểm tra phiên bản hai tuần; hai người nhận thông báo. Lịch sử ghi sự khác biệt giữa đổi có đồng ý và đổi bằng quyền quản trị.

Các trạng thái: Chờ phản hồi, Đã chấp nhận, Đã từ chối, Đã hủy, Không còn hiệu lực.

## Người phụ trách tuần, buổi và người đã đặt thực tế

- Buổi mới mặc định kế thừa người của tuần. Admin có thể chọn **Chỉ định riêng cho buổi này**.
- Người CS trong danh sách tham gia được đánh dấu theo `organizer_id` đã được máy chủ xác định. Không sửa tên thành viên, không dùng chữ đậm hay trạng thái Đi làm quy tắc phân công.
- Đổi phân công cập nhật người phụ trách các buổi kế thừa. Buổi chỉ định riêng giữ đúng người riêng.
- Khi xác nhận Đã đặt, lưu người đã đặt thực tế và thời điểm xác nhận. Nếu thành viên CS tự cập nhật, máy chủ ghi đúng danh tính đã xác minh; admin có thể chọn người thực tế khi xác nhận thay.
- Đổi người tuần không sửa người đã đặt thực tế, trạng thái sân, địa chỉ, sân, tiền, đặt cọc, đăng ký hoặc ghi chú tham gia. Lịch sử từng lần xác nhận sân được giữ riêng.
- Dữ liệu cũ có Đã đặt giữ người phụ trách cũ làm thông tin người đặt đã biết. Không tự gán thời điểm đặt trước đây; lịch sử ghi rõ đây là dữ liệu được giữ khi nâng cấp. Người phụ trách cũ khác người của tuần được bảo toàn thành chỉ định riêng.
- CS chọn Không đi vẫn giữ trách nhiệm. CS cập nhật sân/ngày giờ/tiền dự kiến/liên hệ/cọc của buổi mình phụ trách sau xác minh; đổi người, tạo buổi, hạn đăng ký và giới hạn người thuộc quản trị. Đổi ngày sang tuần của người khác cần admin.
- Sao chép lịch sang tuần sau lấy người tuần mới cho buổi kế thừa, giữ chỉ định riêng, đặt lại Chưa đặt, bỏ xác nhận/tiền cọc thực tế và không sao chép đăng ký cũ.

## Database và Realtime

| Thành phần                   | Mục đích                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `weekly_booking_assignments` | Tuần, người ban đầu/hiện tại, người đã hoàn thành, phiên bản                                 |
| `booking_rotation_members`   | Điều kiện, thứ tự, mức độ xác nhận lịch sử, tổng ban đầu và mốc chống tính trùng             |
| `booking_swap_requests`      | Hai phân công và hai người tại lúc gửi, phiên bản, trạng thái, người xử lý, thời gian, lý do |
| `booking_notifications`      | Thông báo cá nhân và trạng thái đã đọc                                                       |
| `booking_history`            | Lịch sử tuần, đổi lượt, chỉ định riêng và các xác nhận sân                                   |
| `booking_sync`               | Một bộ đếm công khai để báo thay đổi qua Realtime, không chứa thông báo hay mã đăng nhập     |
| `private.booking_invites`    | Chỉ hash mã dùng một lần và hạn dùng                                                         |
| `private.booking_devices`    | Chỉ hash token thiết bị, liên kết thành viên, hạn dùng                                       |
| `private.booking_swap_slots` | Khóa duy nhất từng phân công khi có yêu cầu chờ, tránh chồng chéo                            |

Không cấp quyền ghi bảng trực tiếp cho khách/thành viên. Các RPC quản trị kiểm tra Auth admin; RPC thành viên suy ra ID từ tài khoản đã liên kết hoặc token thiết bị đã xác minh, không nhận member ID làm bằng chứng đăng nhập. Mã dùng một lần và token không xuất hiện trong lịch sử hay snapshot công khai.

Mọi thay đổi được ghi tập trung vào Supabase. Trigger cập nhật `booking_sync`; mọi phiên được phép đọc bộ đếm này nên nhận được INSERT/UPDATE/DELETE qua Supabase Realtime ngay cả khi dùng mã cá nhân, không cần công khai bảng thông báo. Frontend lấy lại một snapshot nhất quán chứa cả hai tuần và các buổi kế thừa. Khi nối lại, online/focus, hoặc đối soát định kỳ, tải snapshot mới để không bỏ sót sự kiện.

LocalStorage chỉ giữ tùy chọn giao diện, tên chọn cho đăng ký nhanh và thông tin phiên xác minh của thiết bị; không phải nơi lưu phân công, yêu cầu, lịch sử hoặc dữ liệu sân. Không cập nhật lạc quan: chỉ báo đã lưu sau RPC thành công; offline khóa lưu; xung đột phiên bản trả lỗi và giữ biểu mẫu đang nhập để xử lý.

## Bằng chứng kiểm thử và nghiệm thu trực tuyến

Kiểm thử [PostgreSQL](../tests/booking-database.test.ts) dùng database PGlite thật với hai token thành viên độc lập, và vai trò anon/authenticated để kiểm tra quyền. Supabase Auth claims được đại diện bằng `auth.uid()` đọc claim trong phiên test. Có thử gây lỗi ở tuần thứ hai để kiểm tra rollback cả giao dịch. Đây là kiểm thử database cục bộ, **không phải** bằng chứng Realtime Supabase giữa hai trình duyệt.

Kiểm thử [giao diện](../tests/booking-ui.test.tsx) kiểm tra nhãn theo ID, tuần qua ranh giới tháng/năm, người đã xác minh khác tên chọn, chỉ người nhận có nút xác nhận, chờ máy chủ, mã sai không đóng form, ghi riêng trường thay đổi và lịch sử chưa rõ chặn đề xuất. Phản hồi máy chủ được điều khiển trong test để kiểm tra thời điểm; sản phẩm không có dữ liệu giả hoặc giả lập đồng bộ.

Supabase thật hiện đã có 7 tuần đúng lịch thống nhất, 11 người trong vòng và publication Realtime `booking_sync` đang bật; các thành viên ngoài vòng không bị tự thêm. Đã kiểm tra giao diện với phân công thật, nhãn CS cạnh Yến theo ID, người đặt từ dữ liệu cũ được giữ riêng, buổi chỉ định riêng vẫn hiện rõ. Trang chủ và cả 7 thẻ phân công không tràn ngang ở 320/375/390/768/1024/1440px; hộp xác minh kiểm tra ở 320/390/768/1440px; danh sách đăng ký có nhãn CS kiểm tra thêm ở 320px. Tải lại vẫn giữ dữ liệu.

47 kiểm thử tự động đạt. Các phiên trình duyệt kiểm tra hiện chỉ có tên đăng ký nhanh, chưa có quyền quản trị/mã cá nhân; vì vậy chưa xác nhận thực nghiệm luồng đổi lượt hai người đã xác minh, Realtime của các thay đổi phân công hoặc phục hồi mạng cho chức năng CS trên Supabase thật. Publication bật và kết nối thành công chưa thay thế kiểm thử hai người cùng thao tác. Các mục dưới đây cần chạy bằng hai danh tính đã xác minh.

Kiểm tra quyền **trên Supabase thật** bằng `npm run check:booking-access` đã đạt: snapshot của khách không trả yêu cầu/thông báo/lịch sử/dữ liệu cấp mã; khách không đọc trực tiếp được ba bảng riêng; dùng member ID làm token bị từ chối khi gửi yêu cầu, xác nhận hoặc cập nhật sân. Các lệnh sửa trong script chỉ dùng ID mục tiêu không tồn tại và phải bị chặn ngay ở bước xác minh; không thay đổi dữ liệu nhóm. Đây là kiểm tra quyền âm tính, không thay thế hai phiên đã đăng nhập.

Sau cấu hình, mở **hai profile trình duyệt độc lập** (ví dụ Chrome thường và cửa sổ ẩn danh); hai tab cùng profile dùng chung danh tính thiết bị nên không đại diện hai người. Admin cấp riêng mã A/B, mỗi profile xác minh đúng một người. Kiểm tra:

- [ ] Trang chủ/nhãn CS đúng cả hai tuần; người có tên trùng hoặc chọn tên khác không có quyền thay người đã xác minh.
- [ ] A gửi; phân công giữ nguyên; B tự thấy yêu cầu/thông báo mà không tải lại.
- [ ] B đồng ý; cả hai tuần, CS các buổi kế thừa và các thiết bị cùng đổi; buổi riêng giữ nguyên. Tải lại vẫn đúng.
- [ ] Từ chối/hủy không đổi tuần; người khác không xác nhận, hủy hay đánh dấu thông báo thay.
- [ ] Admin sửa một tuần trong lúc chờ: yêu cầu cũ vô hiệu, không thể chấp nhận lại.
- [ ] Chặn yêu cầu chồng chéo, đổi với chính mình, tuần đã kết thúc; tuần sau chưa có người có hướng dẫn.
- [ ] CS chọn Không đi vẫn phụ trách; đăng ký, ghi chú, sân đã đặt và người đã đặt thực tế được giữ sau đổi.
- [ ] Sửa sân/tiền/cọc ở một profile, profile khác tự cập nhật; mất mạng không báo thành công, online lấy lại đầy đủ.
- [ ] Hai buổi cùng tuần chỉ tính một lượt hoàn thành; phụ trách riêng có lịch sử riêng; sửa dữ liệu lịch sử không tự đổi lịch đã chốt.
- [ ] Lịch sử ghi người ban đầu/sau đổi, hai khoảng tuần, người gửi/người xác nhận, thời gian, lý do; thử 320px và Zalo thật.

Chạy `npm test` và `npm run build` sau thay đổi. Không cần triển khai backend mới ngoài migration Supabase; hosting frontend vẫn build `dist` như hướng dẫn hiện có.
