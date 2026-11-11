# Cầu lông và những người bạn

React + TypeScript + Vite, Tailwind và Supabase. Đăng ký cầu lông nhanh: **mở link → chọn tên → bấm Đi**. Phân công CS, tài chính và du lịch dùng danh tính đã xác minh bằng mã cá nhân hoặc tài khoản Supabase Auth.

## Album đội

Album chung có chế độ ảnh bay chậm/dừng chuyển động và lưới, xem ảnh lớn/vuốt/phóng to/tải ảnh, chọn nhiều file/kéo thả, chú thích và Thùng rác. Mọi khách đều quản lý được album; quyền lịch đánh và tài chính giữ nguyên. Ảnh gốc và thumbnail lưu trong Supabase Storage, metadata lưu PostgreSQL và đồng bộ qua Realtime riêng.

Chạy [migration Album đội](./supabase/migrations/202611110001_team_album.sql) trong Supabase SQL Editor rồi triển khai lại frontend. Dùng URL/key đang có, không thêm khóa bí mật. Mở trực tiếp `/#album` để vào album mà không cần chọn tên. Xem [cấu hình và nghiệm thu Album đội](./docs/team-album.md), kiểm tra backend chỉ đọc bằng `npm run check:album-access`. Không có ảnh mẫu hoặc dữ liệu đồng bộ giả.

Nếu đã cài album trước bản sửa xung đột, chạy tiếp [bản sửa HTTP 409](./supabase/migrations/202611110002_album_conflict_http.sql) để yêu cầu sửa từ phiên bản cũ trả thông báo ngay, tránh vòng lặp thử lại của PostgREST. Bản sửa giữ nguyên ảnh và dữ liệu.

## Tiền sân, thanh toán và du lịch

**Cập nhật thao tác nhanh:** chạy [migration 004](./supabase/migrations/202611100004_auto_fees_and_covers.sql) sau bản tài chính 003 để lịch mới tự có bảng phí trống và chọn ảnh bìa trực tiếp từ thiết bị. Bucket ảnh và quyền upload được tạo trong cùng migration; không cần thêm khóa bí mật. Sau đó chạy [migration cập nhật thực tế](./supabase/migrations/202611110003_practical_updates.sql) để chuẩn hóa quyền `can_manage`, xử lý xung đột phiên bản bằng HTTP 409 và dùng snapshot gộp. Xem [hướng dẫn cập nhật](./docs/finance-travel.md#cập-nhật-lịch-tự-có-bảng-phí-và-chọn-ảnh-từ-thiết-bị). Kiểm tra hiện tại: build đạt và `npm test` đạt 199/199; chưa nghiệm thu upload thật hoặc đồng bộ hai thiết bị trên Supabase sau migration.

Đã bổ sung chia tiền theo từng nhóm ca/sân, xác nhận người chịu phí, chốt/mở lại bảng phí, thu/hoàn thủ công có lịch sử; chuyến đi có khách, suất chia, dự toán/thực tế, tiền ứng và danh sách chuẩn bị.

Nếu đã dùng Phân công CS, chỉ cần chạy [migration tài chính mới](./supabase/migrations/202611100003_finance_travel.sql), rồi tải lại website. Xem [hướng dẫn sử dụng và cấu hình](./docs/finance-travel.md). Không nhập dữ liệu lịch sử từ Google Sheets và không ghi đè các buổi hiện có.

## Bật đăng ký nhanh trên Supabase đang dùng

Nếu đã chạy migration ban đầu và kết nối URL/key:

1. Mở [migration nâng cấp](./supabase/migrations/202611100001_quick_registration.sql), sao chép toàn bộ nội dung.
2. Vào Supabase **SQL Editor → New query**, dán và bấm **Run**. Giữ nguyên thành viên, đăng ký, lịch sử và tài khoản quản trị cũ. Không chạy lại migration ban đầu.
3. Tải lại website. Nút **Chọn tên** sẽ bật, lần đầu mở danh sách tên.
4. Có thể kiểm tra bằng terminal:

   ```sh
   npm run check:connection
   ```

Lệnh này chỉ đọc API, không in URL/key, không sửa dữ liệu. Nếu báo `PGRST202`, database chưa có migration nâng cấp hoặc API chưa cập nhật schema cache. Sau khi chạy SQL, có thể chạy `NOTIFY pgrst, 'reload schema';` trong SQL Editor rồi thử lại.

**Kiểm tra cấu hình:** `npm run check:connection` báo riêng đăng ký nhanh, phân công CS và tài chính/du lịch. URL/key công khai không đủ quyền tạo bảng: nếu thiếu tính năng, chạy migration tương ứng trong SQL Editor. Website hiển thị rõ phần chưa cấu hình, không giả lập lưu dữ liệu.

## Chạy trong VS Code

Mở thư mục dự án, chọn Terminal → New Terminal. Khuyến nghị Node.js 24 LTS từ 24.15 trở lên để chạy cả công cụ kiểm thử:

```sh
npm install
npm run dev
```

Mở URL Vite in ra. Cổng mặc định là `5173`; nếu đang có tiến trình khác, có thể dùng `5174`. Sau khi sửa biến môi trường, dừng Vite bằng Ctrl+C rồi chạy lại.

Nếu chưa có `.env`, sao chép [.env.example](./.env.example) thành `.env` rồi điền:

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Vite không đọc `.env.example`. Không thay `.env` đang có cấu hình thật bằng giá trị mẫu. Chỉ dùng publishable/anon key ở frontend; không dùng secret key, service_role hoặc mật khẩu database. `.env` đã được bỏ qua trong Git.

```sh
npm run build             # TypeScript + production trong dist/
npm run preview           # Xem production
npm test                  # PostgreSQL + React
npm run check:connection  # Kiểm tra API đăng ký nhanh
```

## Cách dùng nhanh

- **Chọn tên:** chọn đúng tên và mã CL-xxxx một lần. Thiết bị chỉ ghi nhớ mã thành viên, không lưu lịch/đăng ký vào localStorage. Đổi tên ở thanh trên cùng. Nếu trình duyệt không cho ghi nhớ, tên vẫn dùng được trong tab hiện tại.
- **Một chạm đăng ký:** buổi sắp tới có Đi / Không đi / Chưa phản hồi. Mỗi thẻ ca/sân trong tuần cũng có ba nút này. Trên điện thoại, buổi sắp tới đứng trước banner để dễ thao tác.
- **Ghi chú tự lưu:** ô ghi chú của buổi sắp tới tự lưu sau khi dừng nhập 700ms hoặc rời ô. Chỉ hiện Đã lưu sau khi máy chủ xác nhận. Nếu lỗi, giữ bản nháp và có Thử lại. Bản nháp còn trong bộ nhớ khi chuyển trang trong ứng dụng; nếu đóng/tải lại khi còn bản nháp, trình duyệt được yêu cầu cảnh báo. Bản nháp không thay thế dữ liệu trên Supabase. Ghi chú trong cửa sổ chi tiết, kể cả khi quản trị sửa thay người khác, cũng dùng cơ chế tự lưu này.
- **Nhiều ô cùng một ghi chú:** dùng chung bản nháp trong tab và gửi lần lượt, tránh gửi trùng. Nếu thiết bị khác sửa khi đang gõ, chọn Dùng bản mới hoặc Giữ bản của tôi; không ghi đè ngầm.
- **Ai đi:** mở dòng tổng số người dưới mỗi ca để xem tên, số chỗ còn lại, ghi chú và người Chưa phản hồi/Không đi. Chi tiết buổi vẫn có bảng và thời điểm cập nhật; tên đang chọn được ghim đầu danh sách.
- **Nhiều ca một lần:** mở Đăng ký nhiều ca / sân ở lịch tuần, chọn các ca và trạng thái. Mỗi ca có kết quả riêng: ca còn chỗ được lưu, ca đầy/đã hủy/hết hạn báo lý do và vẫn được chọn để xử lý tiếp. Không báo thành công toàn bộ nếu có ca thất bại.
- **Mẫu lịch:** quản trị điền sân/giờ rồi chọn Lưu thành mẫu. Lần sau tạo buổi, chọn mẫu để điền sẵn. Ngày theo ngày đang chọn, đặt sân về Chưa đặt, hạn đăng ký trống, không có đăng ký cũ. Lưu cùng tên cập nhật mẫu đó.
- **Sao chép tuần:** ca chưa hủy chuyển +7 ngày, hạn +7 ngày, đặt sân về Chưa đặt, không sao chép xác nhận/ghi chú tham gia.
- **Đặt sân:** người phụ trách cập nhật trạng thái; website không tự đặt sân với chủ sân.

Mỗi ngày/khung giờ/sân là một mục riêng. Mọi thời gian là giờ Việt Nam (UTC+7). Buổi đã hủy hoặc kết thúc không nhận thay đổi. Sau hạn đăng ký, chỉ quản trị viên được sửa thay.

## Thiết lập Supabase mới

1. Tạo project tại https://supabase.com/dashboard.
2. Chạy lần lượt [migration ban đầu](./supabase/migrations/202611090001_initial.sql) rồi [migration đăng ký nhanh](./supabase/migrations/202611100001_quick_registration.sql) trong SQL Editor. Với CLI, liên kết project rồi `supabase db push`.
3. Lấy Project URL và publishable key tại Connect / Settings → API Keys, điền `.env`.
4. Publication `supabase_realtime` cần bảy bảng: `sessions`, `members`, `attendance`, `account_links`, `audit_log`, `session_roster`, `session_templates`. Migration tự thêm các bảng.
5. Thành viên đã có thể chọn tên; chỉ cấu hình email tiếp theo nếu cần quản trị.

Danh sách ban đầu: Dũng, Trường, Hiền, Quyết, Yến, Chi, Nguyên, Khôi, Newbie Long, Mỹ Linh, Ái. Tên có thể trùng, mã không trùng.

## Tạo quản trị viên đầu tiên

1. Authentication → Providers → Email: bật email và cho phép đăng ký.
2. Authentication → URL Configuration: khi chạy thử, Site URL là `http://127.0.0.1:5173`; thêm URL đó và `http://localhost:5173` vào Redirect URLs nếu dùng. Nếu Vite dùng cổng khác, thêm đúng URL/cổng. Khi triển khai, đặt domain HTTPS thật.
3. Mở biểu tượng khiên trên máy tính hoặc menu → Đăng nhập quản trị trên điện thoại. Nhập email, mở link xác nhận trong cùng trình duyệt. Có thể thêm `{{ .Token }}` vào mẫu email Magic Link/Confirm Signup để dùng OTP.
4. Trong SQL Editor, tìm mã đúng người:

   ```sql
   select id, code, display_name from public.members order by code;
   ```

5. Thay email và mã trong câu sau. `CL-0001` là Dũng trong dữ liệu ban đầu:

   ```sql
   insert into public.account_links (user_id, member_id, role)
   select u.id, m.id, 'admin'
   from auth.users u cross join public.members m
   where lower(u.email) = lower('EMAIL_QUAN_TRI_CUA_BAN')
     and u.email_confirmed_at is not null
     and m.code = 'CL-0001'
   returning member_id, role;
   ```

   Cần trả một dòng. Nếu email đã liên kết, chủ dự án có thể dùng:

   ```sql
   update public.account_links set role='admin'
   where user_id=(select id from auth.users where lower(email)=lower('EMAIL_QUAN_TRI_CUA_BAN'));
   ```

6. Tải lại web. Xuất hiện nút tạo lịch, quản lý thành viên, lịch sử. Liên kết email cho thành viên thường không còn bắt buộc.

Email mặc định Supabase có hạn mức và giới hạn người nhận. Nếu email quản trị không nhận được thư hoặc cần nhiều email quản trị, cấu hình Custom SMTP. Thành viên đăng ký nhanh không phụ thuộc SMTP.

## Dữ liệu và đồng bộ

Đây là chế độ nhóm tin cậy theo yêu cầu: ai có link có thể xem tên/ghi chú/đăng ký và chọn tên để đăng ký thay. Tên chọn không phải danh tính xác minh. Nhật ký thêm hậu tố “chọn tên” cho luồng nhanh. Email, dữ liệu Auth và tài khoản quản trị không được công khai.

| Bảng                | Vai trò                                              | Quyền đọc hiện tại         |
| ------------------- | ---------------------------------------------------- | -------------------------- |
| `members`           | Mã, tên, ghi chú, hoạt động                          | Công khai trong nhóm       |
| `sessions`          | Ca/sân, giờ, địa chỉ, người đặt, giới hạn            | Công khai                  |
| `attendance`        | Duy nhất buổi + thành viên, trạng thái, note_version | Công khai trong nhóm       |
| `session_roster`    | Danh sách theo buổi, bảo toàn lịch sử                | Công khai trong nhóm       |
| `account_links`     | Auth user, thành viên, role                          | Chính tài khoản hoặc admin |
| `audit_log`         | Ai sửa, trường đổi, before/after, thời điểm          | Admin                      |
| `session_templates` | Thông tin sân/giờ dùng lại                           | Admin                      |

Không cấp quyền ghi bảng trực tiếp cho khách. RPC nhanh chỉ sửa đăng ký; không thêm/xóa thành viên, tạo lịch, đọc nhật ký hoặc nâng quyền. Quản trị vẫn được kiểm tra tại PostgreSQL.

`quick_set_attendance` và `set_attendance` dùng chung kiểm tra và khóa dòng buổi để chống vượt chỗ. Đổi trạng thái chỉ ghi trạng thái; ghi chú chỉ ghi ghi chú, kiểm tra note_version. Nhiều ca được khóa theo thứ tự cố định và trả kết quả riêng. Thành viên ngừng hoạt động bị chặn đăng ký; lịch sử/danh sách cũ giữ nguyên.

Frontend nhận INSERT/UPDATE/DELETE qua Realtime, gom sự kiện 120ms rồi lấy snapshot database mới. Khi nối lại, focus hoặc online, lấy lại dữ liệu; đối soát thêm mỗi 30 giây khi tab mở. Snapshot nhóm lấy trong một câu SQL, tránh giới hạn 1.000 dòng. Không cập nhật lạc quan, không báo đã lưu khi máy chủ chưa xác nhận.

## Phụ trách đặt sân theo tuần (CS)

Đã bổ sung trang **Phân công CS**, phụ trách tuần này/tuần sau trên trang chủ, nhãn CS theo ID trong đăng ký, đổi lượt có đồng ý, đề xuất lịch công bằng, vòng đủ điều kiện, lịch sử ban đầu và thông báo trong website. Phân công không đồng nghĩa Đã đặt; thông tin người đã đặt thực tế được lưu riêng. Mã cá nhân dùng một lần xác minh quyền đặt sân, không cần email cho thành viên; chọn tên đăng ký nhanh không cấp quyền này.

**Khi nâng cấp một backend khác**, chạy [migration phân công CS](./supabase/migrations/202611100002_booking_responsibility.sql), gồm cả phần REALTIME cuối file. Không cần thay hai biến môi trường hoặc thêm khóa bí mật. Backend của nhóm đã xác nhận có 7 tuần, 11 người trong vòng và publication Realtime CS đang bật. Admin cấp mã và nhập/xác nhận lịch sử ban đầu cho các thành viên đủ điều kiện trước khi đề xuất lịch.

[Hướng dẫn đầy đủ: cấu hình, cấp mã, phân công, đổi lượt, số lượt ban đầu và nghiệm thu hai trình duyệt](./docs/booking-responsibility.md).

## Giao diện thể thao và chuyển động

Giao diện dùng xanh rừng, trắng ngà và lime; banner ảnh cầu lông riêng, tiêu đề lớn, lịch tuần, thẻ thành viên và hộp thoại cùng một phong cách. Trên điện thoại, buổi sắp tới đứng trước banner để đăng ký nhanh; nút trạng thái cao 47px và ô ghi chú dùng cỡ chữ 16px.

Hiệu ứng gồm tiêu đề xuất hiện lần lượt, ảnh nổi/chuyển động nhẹ trong banner, vòng quỹ đạo, dải chữ chạy liên tục, lịch hiện lần lượt, nội dung xuất hiện khi cuộn, phản hồi nút, số người thay đổi sau dữ liệu máy chủ và hộp thoại chuyển cảnh. Hiệu ứng không thay thế trạng thái lưu dữ liệu. Bấm biểu tượng lấp lánh trên thanh đầu trang để giảm/bật hiệu ứng; thiết bị sẽ nhớ lựa chọn. Website cũng tôn trọng cài đặt giảm chuyển động của hệ điều hành và dừng chuyển động nền khi ra khỏi màn hình hoặc ẩn tab.

Không thêm thư viện animation. Font Be Vietnam Pro được lưu tại dự án kèm giấy phép OFL; ảnh banner JPEG khoảng 238 KB. [Ghi chú thiết kế và prompt ảnh](./design/visual-refresh.md).

## Kiểm thử

- Kiểm tra hiện tại: `npm test` đạt **199/199** trường hợp; `npm run build` thành công. Đây là kiểm thử cục bộ, không thay thế nghiệm thu hai danh tính/thiết bị trên Supabase thật.
- PostgreSQL/PGlite: 15 kiểm thử đạt, gồm nâng cấp từ database có dữ liệu, bảo toàn lịch sử, đăng ký không email, giới hạn chỗ, xung đột, kết quả riêng từng ca, quyền quản trị và mẫu lịch.
- React/JSDOM: 8 kiểm thử đạt, gồm chọn mã khi trùng tên, chờ xác nhận máy chủ, tự lưu, giữ bản nháp sau lỗi/rời ô, xung đột, phục hồi offline, nhiều ô cùng ghi chú gửi lần lượt. Phản hồi máy chủ có kiểm soát phục vụ kiểm tra thời điểm; đây không phải bằng chứng Realtime trên Supabase thật.
- Trình duyệt với Supabase hiện tại: đã tải được lịch, danh sách thật và API đăng ký nhanh. Trang lịch, thành viên, chọn tên và chi tiết đăng ký không tràn ngang ở 320/390/768/1440px; trang lịch kiểm tra thêm 375/1024px. Đã kiểm tra tìm thành viên, chuyển tuần, nhớ tên sau tải lại, bật/tắt hiệu ứng và nhớ lựa chọn sau tải lại, chế độ giảm chuyển động của hệ điều hành. Không có lỗi JavaScript trong lượt kiểm tra tải lại trang. Lượt làm mới giao diện chỉ đọc dữ liệu thật, không sửa đăng ký của nhóm.
- Phân công CS: 16 kiểm thử PostgreSQL/PGlite và 8 kiểm thử giao diện bổ sung, gồm giao dịch đổi hai tuần (có thử lỗi ở tuần thứ hai), xác minh bằng mã, chặn mạo danh/chồng chéo/yêu cầu cũ, giữ người đã đặt, nhập lịch sử không tính trùng, đề xuất công bằng, khởi tạo không ghi đè và xử lý tên thiếu/trùng.
- Tài chính/du lịch: 13 kiểm thử PostgreSQL/PGlite và 8 kiểm thử React bổ sung, gồm chia một/nhiều nhóm, phần dư và làm tròn, chốt/mở lại, thu đủ chống trùng, sửa khoản thu nguyên tử, hoàn tiền, suất trẻ em, ứng/hoàn ứng, quyền và xung đột ghi chú. Bố cục bảng phí kiểm tra riêng với dữ liệu kiểm thử, không tràn ngang ở 320/375/390/768/1024/1440px. Trang thật báo thiếu migration đúng trạng thái; hai mục mới không có lỗi JavaScript trong lượt chuyển trang kiểm tra.
- Kết quả trước cập nhật 004: 68 kiểm thử đạt; build thành công. Supabase thật đã xác nhận 7 tuần, 11 người trong vòng và Realtime CS được bật; trình duyệt hiển thị đúng phân công và nhãn CS, giữ dữ liệu sau tải lại. Chưa nghiệm thu đổi lượt giữa hai danh tính đã xác minh trên Supabase thật vì các phiên kiểm tra chưa đăng nhập quản trị để cấp mã. Không có dữ liệu giả hoặc hiệu ứng giả đồng bộ trong sản phẩm. Xem [hướng dẫn nghiệm thu CS](./docs/booking-responsibility.md) và [trạng thái cập nhật tài chính/du lịch](./docs/finance-travel.md).
- `npm run check:booking-access` đã đạt trên Supabase thật: chặn khách đọc bảng riêng và chặn dùng member ID làm token để gửi/xác nhận đổi lượt hoặc sửa sân. Các mục tiêu sửa là ID không tồn tại; dữ liệu nhóm không bị thay đổi.

Các bước nghiệm thu đồng bộ trực tuyến cần kiểm tra thêm:

- [ ] Hai trình duyệt chọn hai tên, không email. A chọn Đi, B thấy tên/tổng ngay.
- [ ] A gõ ghi chú, B thấy sau máy chủ xác nhận; tải lại giữ đúng. Hai thiết bị cùng tên sửa khác nội dung phải báo xung đột.
- [ ] Tải lại nhớ tên; đổi tên tác động đúng member ID; người ngừng hoạt động không được chọn.
- [ ] Giới hạn một chỗ, hai người cùng đăng ký: chỉ một thành công. Nhiều ca có ca đầy vẫn lưu ca còn chỗ, báo riêng ca lỗi.
- [ ] Offline không báo Đã lưu. Online lấy đủ thay đổi, xử lý bản nháp không ghi đè bản mới.
- [ ] Admin thêm/sửa/xóa người chưa có lịch sử; phiên khác cập nhật. Người có lịch sử phải ngừng hoạt động.
- [ ] Tạo từ mẫu/sao chép tuần: Chưa đặt, không có xác nhận cũ. Kiểm tra màn hình 320/375/390/768/1440px và Zalo thật.

## Triển khai

Vercel/Netlify/Cloudflare Pages: install `npm ci`, build `npm run build`, output `dist`. Đặt hai biến `VITE_SUPABASE_*` trên hosting trước build; thay env cần rebuild/redeploy. Cập nhật URL Auth đúng domain HTTPS. Netlify/Cloudflare đã có [quy tắc SPA](./public/_redirects).

Không đưa `.env` lên Git. Nâng cấp database trước khi dùng luồng mới. Phiên làm việc này chưa triển khai hosting.
