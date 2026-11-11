# Album đội

Album dùng lại màu xanh đậm, lime và font của website. Có hai chế độ **Ảnh bay** và **Lưới ảnh**, dùng cùng dữ liệu Supabase. Không có dữ liệu mẫu hoặc mô phỏng đồng bộ.

## Bật backend

1. Giữ nguyên dự án Supabase và biến kết nối hiện có. Không cần thêm khóa bí mật hoặc bật đăng nhập cho album.
2. Sau các migration hiện có đến bản `202611100004`, mở [migration Album đội](../supabase/migrations/202611110001_team_album.sql).
3. Trong Supabase → **SQL Editor → New query**, dán **toàn bộ** file và bấm **Run**. Cần chạy cả đoạn publication Realtime ở cuối. Không chỉ chạy phần tạo bảng.
4. Tải lại website hoặc bấm thử kết nối lại tại **Album đội**. Khi triển khai Netlify, build lại source để có mục điều hướng mới; deploy frontend không tự chạy SQL.

Migration không nhập lịch sử, không tạo album/ảnh mẫu và không thay đổi dữ liệu cầu lông, phân công, tài chính hoặc du lịch. Chạy lại chính migration album không tạo trùng nội dung. Không chạy lại các migration cũ sau bản mới vì có thể thay định nghĩa API của tính năng trước.

Nếu bước publication báo lỗi, kiểm tra Supabase → **Database → Publications → supabase_realtime** và bật bảng `public.team_album_sync`, rồi chạy lại migration. Khi chưa có migration hoặc chưa bật publication, giao diện báo rõ trạng thái kết nối; không giả báo đang đồng bộ trực tiếp.

### Bản sửa phản hồi xung đột cho backend đã cài album

Nếu đã chạy migration album trước bản sửa này, chạy toàn bộ [migration sửa HTTP 409](../supabase/migrations/202611110002_album_conflict_http.sql) trong **Supabase → SQL Editor**. Bản sửa chỉ thay mã lỗi xung đột phiên bản trong bốn RPC sửa/xóa/khôi phục album và ảnh; giữ nguyên dữ liệu, quyền, Storage và các API khác. Có thể chạy lại an toàn. Khi cài mới, migration album đã dùng mã đúng; vẫn có thể chạy tiếp bản sửa này để đồng nhất các môi trường.

Xung đột do người khác vừa lưu là lỗi nghiệp vụ **HTTP 409 (`PT409`)**. Bản đầu dùng `40001`, là mã lỗi tuần tự hóa giao dịch; PostgREST 14 có thể lặp giao dịch vô hạn với mã tự phát này, khiến yêu cầu treo thay vì trả thông báo xung đột. Xem [giải thích chính thức của Supabase](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

Sau khi chạy bản sửa, tải lại hai trình duyệt và thử cùng sửa một chú thích từ phiên bản cũ: lần lưu sau phải nhận thông báo xung đột nhanh, giữ nội dung đang nhập và không ghi đè. Các yêu cầu đã bắt đầu bằng định nghĩa cũ có thể vẫn còn hoạt động. Có thể kiểm tra **chỉ đọc** bằng SQL Editor:

```sql
select pid, state, query_start, wait_event_type, wait_event,
       left(query, 400) as query
from pg_stat_activity
where datname = current_database()
  and usename = 'authenticator'
  and backend_type = 'client backend'
  and pid <> pg_backend_pid()
  and state = 'active'
  and query ~ '\m(save_team_album|save_team_album_photo|set_team_album_deleted|set_team_album_photo_deleted)\M'
order by query_start;
```

Đối chiếu đúng tên RPC, thời gian và yêu cầu lưu từ phiên bản cũ trước khi xử lý. Nếu xác nhận một PID đang lặp từ yêu cầu cũ, chủ dự án có thể tự hủy riêng truy vấn đó trong công cụ quản trị hoặc dùng `select pg_cancel_backend(PID_ĐÃ_XÁC_NHẬN);` với PID thực tế. Ứng dụng và migration không tự hủy kết nối hoặc giao dịch của người khác.

### Những gì được tạo

| Thành phần                   | Vai trò                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `public.team_albums`         | Tên, mô tả, ngày hoạt động, loại album, ảnh bìa, phiên bản và dấu Thùng rác                     |
| `public.team_album_photos`   | Đường dẫn ảnh gốc/thumbnail, kích thước, tên tệp, chú thích, phiên bản và dấu Thùng rác         |
| `public.team_album_sync`     | Bộ đếm thay đổi công khai được phát qua Supabase Realtime                                       |
| `private.team_album_uploads` | Quyền tải tạm cho đúng hai đường dẫn ngẫu nhiên, trạng thái hoàn tất và mã thao tác chống trùng |
| `private.team_album_history` | Dấu vết trước/sau của thao tác album và ảnh; không gán tên thành viên cho khách chưa xác minh   |
| Bucket `team-album`          | Tệp ảnh gốc và ảnh WebP thu nhỏ, lưu trực tuyến                                                 |

Storage bucket được tạo tự động trong migration. Ảnh gốc nhận JPG/PNG/WebP tối đa **15 MiB**, thumbnail WebP tối đa **1 MiB**. Ảnh HEIC/HEIF cần xuất sang định dạng hỗ trợ trước khi tải. Giới hạn tài khoản Supabase về dung lượng và lưu lượng vẫn áp dụng.

## Quản lý mở, chỉ trong album

Theo cấu hình nhóm yêu cầu, **bất kỳ người có đường dẫn website đều có thể xem, tạo, sửa, đưa ảnh/album vào Thùng rác và khôi phục**, không cần email hay mã cá nhân. Không có vai trò riêng để hạn chế người xem ảnh.

Quyền này chỉ được cấp cho RPC của Album đội. Các bảng khác vẫn giữ cơ chế xác minh và phân quyền cũ. Trình duyệt không được ghi thẳng vào bảng album; RPC kiểm tra trường hợp lệ, phiên bản và trạng thái Thùng rác. Nếu hai người sửa cùng ảnh/album từ một phiên bản cũ, máy chủ báo xung đột thay vì âm thầm ghi đè.

Bucket ảnh là **công khai** để mọi người xem ảnh không cần đăng nhập. **Đưa vào Thùng rác chỉ ẩn nội dung khỏi album đang hoạt động; tệp gốc và thumbnail vẫn tồn tại, đường dẫn trực tiếp đã biết vẫn xem được.** Bản này không có thao tác xóa tệp vĩnh viễn. Khi cần dọn Storage thật, quản trị dự án phải kiểm tra ảnh còn được dữ liệu/Thùng rác tham chiếu trước khi xóa bằng công cụ Storage; không xóa hàng `storage.objects` trực tiếp bằng SQL.

Khôi phục album giữ nguyên các ảnh đã bị xóa riêng trước đó: chúng vẫn ở Thùng rác cho đến khi người dùng chủ động khôi phục từng ảnh. Xóa ảnh đang làm bìa sẽ bỏ lựa chọn bìa đó; khôi phục ảnh không tự ghi đè lựa chọn bìa mới.

## Thêm và xem ảnh

- Tạo album, nhập tên, mô tả, ngày và loại **Cầu lông / Du lịch / Gặp mặt / Khác**.
- Thêm nhiều ảnh bằng chọn tệp từ điện thoại/máy tính hoặc kéo thả. Không nhập liên kết HTTP. Có xem trước, chú thích và tiến trình tải thật theo dung lượng gửi lên.
- Trình duyệt tạo thumbnail cục bộ, giữ màu ảnh gốc tự nhiên. URL tạm chỉ dùng để xem trước lúc chọn tệp, không phải nơi lưu chính. Ảnh gốc không bị đổi màu hoặc mã hóa lại.
- Khi thử lại một lượt lỗi, máy chủ trả cùng đường dẫn và chỉ tải phần còn thiếu. Chỉ sau khi cả ảnh gốc và thumbnail đã hiện diện trong Storage, đúng MIME/dung lượng, máy chủ mới tạo metadata ảnh. Mã thao tác làm bước hoàn tất idempotent, tránh tạo ảnh trùng khi mất phản hồi mạng.
- Nếu đóng biểu mẫu khi chưa tải xong, tệp chưa hoàn tất có thể còn trong Storage nhưng chưa xuất hiện trong album. Bản này chưa có tác vụ tự dọn tệp chưa sử dụng.
- Mở ảnh lớn để xem chú thích, chuyển ảnh, phóng to và tải ảnh. Lưới/ảnh bay dùng thumbnail; ảnh gốc chỉ được lấy khi mở xem hoặc tải xuống.
- Có nút dừng chuyển động. Hiệu ứng giảm theo thiết bị/tùy chọn giảm chuyển động; chuyển động tạm dừng khi tab ẩn. Số ảnh bay được giới hạn để không phủ quá dày và không tải toàn bộ ảnh gốc.
- Không gian ảnh chuyển trực tiếp 12 bộ quỹ đạo X/Y/Z, công thức pha, độ sâu và tỉ lệ ảnh theo phối cảnh từ phần “Vũ trụ của Huệ”. Ảnh tiến vào từ xa 1.250px với chuyển cảnh 2,65 giây; phối cảnh 1.050px. Nền vũ trụ có sao, sương và vệt sáng được đổi sang xanh rừng/lime; màu ảnh giữ tự nhiên. Không sao chép ảnh, mã truy cập, nhật ký hoặc dữ liệu riêng của website tham chiếu.
- Cả cụm tự xoay theo tốc độ gốc 0,000028 radian/mili giây (khoảng 224 giây/vòng). Từng ảnh vẫn lật trọn vòng quanh X hoặc Y với chiều và tốc độ riêng (14–23°/giây), có mặt trước và mặt sau. Kéo để xoay cụm ảnh với quán tính, cuộn/chụm hai ngón hoặc dùng nút để thu phóng 65–220%; có nút đặt lại góc nhìn. Kéo ảnh không mở nhầm ảnh lớn, chạm hoặc Enter để mở.
- Nút mở toàn màn hình đưa không gian ảnh phủ toàn bộ cửa sổ, khóa cuộn nền và giữ focus bàn phím; Escape hoặc nút thu gọn quay lại trang album. Ảnh lớn tiếp tục dùng trình xem ảnh hiện tại.
- Máy mạnh hiển thị tối đa 8 ảnh bay, điện thoại/máy yếu tối đa 4 và giới hạn vẽ 30 khung hình/giây; chế độ nhẹ vẫn giữ trục Z và vòng xoay 360°. Chỉ tải thumbnail của nhóm ảnh đang hiện. Bấm mở ảnh lớn dừng vòng cập nhật ngay trước khi mở; rê chuột/focus bàn phím tạm dừng để dễ chọn. Nút dừng, chế độ giảm chuyển động, tab ẩn và cảnh nằm ngoài màn hình đều dừng chuyển động; tiếp tục từ vị trí đang dừng, không nhảy bù thời gian.

## Đồng bộ và trạng thái lưu

Mọi INSERT/UPDATE/DELETE metadata phát tín hiệu bằng bộ đếm `team_album_sync`. Thiết bị khác nhận tín hiệu rồi lấy snapshot mới nhất qua `get_team_album_snapshot()`. Không có token, mã xác minh hoặc nội dung tài chính trong kênh album. Xóa bằng Thùng rác là UPDATE, vẫn phát Realtime như các thay đổi khác.

Trang tự tải dữ liệu khi mở, khi kênh Realtime kết nối lại, khi có mạng trở lại, khi quay lại tab và đối soát định kỳ 30 giây. Nếu bỏ lỡ sự kiện trong lúc mất mạng, snapshot mới khôi phục trạng thái đầy đủ. Mất mạng khóa thao tác ghi và báo chưa lưu. **Đã lưu** chỉ xuất hiện sau khi máy chủ xác nhận thao tác; tiến trình gửi file xong chưa có nghĩa ảnh đã được lưu vào album.

## Nghiệm thu hai trình duyệt không đăng nhập

Dùng hai hồ sơ trình duyệt riêng hoặc một cửa sổ thường và một cửa sổ ẩn danh. Cả hai mở cùng URL website, không đăng nhập và không nhập mã thành viên.

1. A tạo album thử. B phải tự thấy album mới mà không bấm tải lại. Kiểm tra tên, ngày, mô tả và loại.
2. A chọn ít nhất hai ảnh, nhập chú thích, tải lên. B phải thấy thumbnail sau khi hoàn tất. Mở ảnh lớn ở B, kiểm tra màu tự nhiên, chú thích và tải xuống đúng ảnh gốc.
3. A sửa chú thích/ảnh bìa. B tự thấy thay đổi. Mở cùng biểu mẫu ở A và B rồi cùng sửa: phiên lưu sau từ dữ liệu cũ phải báo xung đột, không ghi đè âm thầm.
4. A xác nhận đưa một ảnh vào Thùng rác. B tự mất ảnh khỏi album đang xem và thấy ảnh trong Thùng rác. B khôi phục; A tự thấy ảnh trở lại.
5. Xóa riêng một ảnh, sau đó xóa/khôi phục cả album. Ảnh xóa riêng vẫn phải ở Thùng rác; ảnh còn hoạt động trở lại cùng album.
6. Ngắt mạng B. A tạo/sửa dữ liệu. Kết nối lại B; dữ liệu phải tự đầy đủ. Khi B mất mạng, thao tác ghi không được báo thành công.
7. Tải lại cả hai trình duyệt; album/ảnh/chú thích giữ nguyên. Thử hủy hoặc làm gián đoạn upload rồi thử lại; không tạo hai metadata ảnh cho cùng lượt tải.
8. Trên điện thoại, kiểm tra hai chế độ, vuốt chuyển ảnh, zoom, tải xuống, nút dừng và không tràn ngang. Chuyển tab để xác nhận chuyển động dừng.
9. Kiểm tra thành viên chưa xác minh vẫn không được xác nhận thu tiền, sửa phân công hoặc quản lý thành viên. Quyền mở album không được lan sang tính năng khác.

## Phạm vi đã kiểm tra và phần còn phụ thuộc môi trường

[Kiểm thử PostgreSQL/PGlite](../tests/team-album-database.test.ts) kiểm tra hai ngữ cảnh khách dùng chung cơ sở dữ liệu, quyền Storage theo đường dẫn, hoàn tất idempotent, xung đột phiên bản, Thùng rác, khôi phục và cách ly quyền các mục cũ. Đây là PostgreSQL cục bộ với bảng Storage kiểm thử, **không thay thế việc tải ảnh thật và Realtime bằng hai trình duyệt trên Supabase**.

Đã kiểm tra trên Supabase thật bằng hai tab công khai: tải file ảnh, cập nhật chú thích qua Realtime và tự lấy lại dữ liệu sau khi ngắt mạng/kết nối lại; cả hai tab tự cập nhật. Đã có 30 kiểm thử frontend/hook/upload đạt trong lượt kiểm tra hiện tại. Phần xung đột phiên bản qua HTTP đang chờ áp dụng và nghiệm thu bản sửa `PT409` nêu trên; không coi kiểm thử PGlite là bằng chứng lỗi PostgREST đã được sửa trên môi trường thật. Không có tích hợp chia sẻ Zalo tự động, nhận diện người sửa ẩn danh hoặc xóa file vĩnh viễn.

Kết quả kiểm tra ngày 11/11/2026:

| Kiểm tra                                                              | Kết quả                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build TypeScript + Vite production                                    | Đạt                                                                                                                                                                                      |
| PostgreSQL, Storage policy, Thùng rác, xung đột và nâng cấp HTTP 409  | 14/14 kiểm thử cục bộ đạt                                                                                                                                                                |
| Tải ảnh, lightbox, vuốt/pinch, retry, trạng thái lưu và hook Realtime | 30/30 kiểm thử đạt                                                                                                                                                                       |
| Hai tab khách cùng Supabase thật                                      | Tạo album, tải ảnh, sửa chú thích, xóa/khôi phục ảnh tự cập nhật; không đăng nhập                                                                                                        |
| Vòng đời album qua hai client API khách độc lập                       | Tạo, sửa, xóa, khôi phục và dọn album QA trống trên Supabase thật đều đạt                                                                                                                |
| Tải lại trang                                                         | Album, ảnh và chú thích còn nguyên từ máy chủ                                                                                                                                            |
| Ngoại tuyến rồi kết nối lại                                           | Đã ngắt mạng trình duyệt; khóa nút ghi, sau kết nối tự nhận chú thích đã sửa từ client API độc lập                                                                                       |
| Bố cục trang album và lưới ảnh                                        | Không tràn ngang ở 320, 375, 390, 768, 1024px; trang tổng còn kiểm tra 1440 và 1600px                                                                                                    |
| Không gian ảnh vũ trụ: quỹ đạo và tương tác                           | 23/23 kiểm thử đạt: 12 preset gốc, XYZ/scale, entrance, lật X/Y, world 360°, một RAF, kéo/quán tính, chụm/zoom, dừng/ẩn tab, mở ảnh, fullscreen/Escape, chế độ tĩnh và khóa cuộn độc lập |
| Kiểm tra trình duyệt trước bản nâng cấp vũ trụ                        | Bản 3D trước đã kiểm tra phối cảnh, mở/đóng ảnh và kích thước 320–1280px; kết quả này không thay thế nghiệm thu giao diện vũ trụ mới                                                     |
| Tải bản gốc xuống máy                                                 | Fetch ảnh gốc thành công; chưa xác nhận file được lưu qua hộp tải của trình duyệt tích hợp                                                                                               |
| Xung đột trên Supabase thật sau hotfix                                | Chờ chạy migration HTTP 409 rồi kiểm tra lại; bản cũ thực tế bị timeout khi cố lưu phiên bản cũ                                                                                          |

Hai tab kiểm tra dùng cùng trình duyệt tích hợp, không phải hai điện thoại thật hoặc hai hồ sơ trình duyệt riêng. Các trường hợp chậm mạng, hàng đợi và thao tác chạm vẫn nên nghiệm thu thêm trên điện thoại sẽ sử dụng thực tế. Ảnh fixture `badminton-hero.jpg` và album QA trống đã đưa vào Thùng rác sau kiểm tra; ảnh do người dùng tự tải vẫn được giữ.

Lượt kiểm tra trình duyệt của bản 3D trước dùng ảnh đang có trên Supabase, không thêm hoặc sửa dữ liệu. Ở bản nâng cấp vũ trụ, công cụ trình duyệt không khởi động được do lỗi môi trường OpenSSL; chưa quan sát trực tiếp lại giao diện và chưa đo FPS trên điện thoại thật. Quỹ đạo gốc, entrance, vòng quay, tương tác kéo/chụm/thu phóng, chế độ tĩnh và vòng đời toàn màn hình được kiểm thử tự động riêng.
