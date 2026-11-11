# Rà soát toàn dự án — 11/11/2026

Ưu tiên: thao tác nhanh, dễ dùng trên điện thoại, không mất nội dung đang nhập và ghi nhận đúng tiền. Nội dung ban đầu bên dưới ghi lại các lỗi phát hiện trước khi sửa; trạng thái được cập nhật theo worktree hiện tại. Không sửa dữ liệu của nhóm trên Supabase.

## Cập nhật sau khi tiếp tục

- Đã sửa đường đi hoàn tiền, chuẩn hóa `can_manage` thành boolean và đặt lại ngữ cảnh DB test sau mỗi kịch bản.
- Đã thêm đối chiếu phiên bản mới cho biểu mẫu, cảnh báo bỏ thay đổi và cảnh báo rời trang khi hàng đợi ảnh/chú thích còn việc chưa lưu.
- Đã đồng bộ mục đang xem và bản ghi vào URL, hỗ trợ Back/Forward; bổ sung tiện ích “Việc của tôi”, checklist một chạm, tìm không dấu và xuất CSV/tin nhắn.
- Xác minh cục bộ: `npm test` đạt **199/199** và `npm run build` thành công. Đây không phải nghiệm thu upload thật, Zalo hay Realtime hai thiết bị; chưa triển khai các migration mới lên Supabase trong lượt này.

## Kết quả kiểm tra

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| `npm run build` | Đạt: TypeScript và Vite production |
| `npm test` trước khi tiếp tục | 157 trường hợp theo bộ đếm Node: 154 đạt, 3 thất bại; lỗi sau đó được xử lý |
| `npm test` hiện tại | 199/199 đạt |
| `npm run build` hiện tại | Đạt: TypeScript và Vite production |
| `npm run check:connection` | Đạt; đăng ký nhanh, phân công CS, tài chính/du lịch và tự tạo bảng phí đã bật trên backend hiện tại |
| `npm run check:album-access` | Đạt; API Album đội hoạt động và publication Realtime đã bật. Chỉ đọc dữ liệu, không tạo/sửa/xóa ảnh |
| Kiểm tra nguồn | Đã đọc các luồng lịch/thành viên/CS, tài chính/du lịch, album, hook dữ liệu, migration và kiểm thử liên quan |
| Trình duyệt, Zalo và hai điện thoại thật | Chưa nghiệm thu lại trong lượt này. Công cụ trình duyệt đã gặp lỗi môi trường ở các lượt trước; không lấy kết quả đọc source/kiểm thử cục bộ làm bằng chứng đã kiểm tra Zalo hoặc Realtime hai thiết bị |

## Lỗi đã phát hiện ban đầu

### 1. Nút “Hoàn tiền” có thể mở loại “Thu tiền”

**Mức ưu tiên: cao. Xác nhận theo đường đi của code, chưa tạo giao dịch thử trên dữ liệu thật.**

Ví dụ: một người đã đóng trước 555.000đ cho chuyến đi, sau đó chọn Không đi khi phí còn tạm tính hoặc đã được mở lại. Người này còn trong danh sách chuyến đi nhưng không còn trong danh sách chia phí. [FeePeople](../src/ActivityFeatures.tsx#L1139) thêm dòng nghĩa vụ 0đ để hoàn tiền và hiển thị nút “Hoàn tiền”. Tuy nhiên [PaymentForm](../src/ActivityFeatures.tsx#L2184) dùng nghĩa vụ thiếu bằng `Infinity` khi chọn loại giao dịch, nên mặc định thành `collection`; phần điền số tiền lại dùng nghĩa vụ bằng 0 và điền 555.000đ.

Nếu giữ mặc định rồi xác nhận, có thể ghi thêm một khoản thu thay vì hoàn. [RPC ghi khoản thu](../supabase/migrations/202611100003_finance_travel.sql#L291) chỉ yêu cầu người đó vẫn thuộc chuyến đi, nên đây không chỉ là nhãn hiển thị.

**Sửa nhỏ nhất:** nút hoàn truyền rõ loại `refund`; dùng cùng một cách xác định nghĩa vụ cho nhãn, loại và số tiền. Màn xác nhận ghi rõ “Hoàn cho …, số tiền …”.

**Nghiệm thu:** trường hợp trên phải gửi `p_kind=refund`, số tiền 555.000đ và tiền đóng ròng còn 0; kiểm tra thêm thu thiếu, thu thừa, khách đi cùng và hoàn tiền ứng.

### 2. Bộ kiểm thử tự tạo phí chưa đạt

**Mức ưu tiên: cao trước lần triển khai tiếp theo. Có kết quả kiểm thử tái hiện.**

Ở [migration tự tạo phí](../supabase/migrations/202611100004_auto_fees_and_covers.sql#L121), biểu thức `can_manage` có thể trả `null` do phép so sánh SQL với `organizer_id=null`. [Kiểm thử](../tests/auto-fees-database.test.ts#L313) đòi hỏi boolean `false` nên thất bại. Điều này chưa chứng minh người không phụ trách được sửa tiền: `null` vẫn là giá trị falsy trên giao diện.

Sau lỗi này, ngữ cảnh khách chưa được đổi lại tại [cuối ca kiểm thử](../tests/auto-fees-database.test.ts#L338), khiến ca tạo lịch tiếp theo lỗi `permission denied for function save_session`. Bộ đếm báo ba thất bại gồm hai ca con và nhóm cha.

**Sửa:** chuẩn hóa kết quả API về boolean; dọn ngữ cảnh kiểm thử bằng `finally` hoặc thiết lập riêng cho mỗi ca. Backend đã triển khai cần migration nâng cấp phù hợp, thay vì chỉ sửa file migration cũ.

**Nghiệm thu:** toàn bộ bộ kiểm thử đạt, đặc biệt xác nhận bảng phí/tiền đã thu không mất khi sửa hoặc sao chép lịch. Không bỏ kiểm thử chỉ để làm báo cáo xanh.

### 3. Biểu mẫu mắc ở phiên bản cũ sau khi người khác sửa

**Mức ưu tiên: cao với nhóm dùng đồng thời. Xác nhận bằng code.**

[Modal thành viên/lịch](../src/App.tsx#L1062) giữ bản ghi lúc mở; các form tiếp tục gửi version ban đầu tại [MemberForm](../src/App.tsx#L1446) và [SessionForm](../src/App.tsx#L1641). [Reload khi lỗi](../src/useClub.ts#L367) cập nhật danh sách nhưng không thay bản ghi nằm trong modal. Vì vậy bấm lưu lại có thể vẫn thất bại cho đến khi đóng và nhập lại.

[Cửa sổ chốt phí](../src/ActivityFeatures.tsx#L2110) cũng giữ revision ban đầu, trong khi số tiền hiển thị lấy từ props mới. Revision còn là bộ đếm toàn nhóm, nên thay đổi ở hoạt động khác cũng có thể làm yêu cầu chốt bị cũ.

**Sửa:** giữ bản người dùng đang nhập, báo có bản mới, cung cấp “Xem thay đổi / Áp dụng lại phần của tôi” sau đối chiếu. Không tự đổi version rồi ghi đè tất cả trường. Về sau dùng version theo hoạt động cho chốt phí.

**Nghiệm thu:** hai phiên sửa cùng bản ghi; phiên sau xử lý xung đột ngay trong form, không mất nội dung và không phải đóng/mở lại.

### 4. Dễ mất nội dung biểu mẫu và hàng đợi ảnh

**Mức ưu tiên: vừa đến cao. Xác nhận bằng code.**

[Modal](../src/Modal.tsx#L29) gọi đóng thẳng khi Escape, chạm nền hoặc bấm X; phần chi phí/chuyến đi/thu tiền có thể bị unmount mà không hỏi bỏ bản nhập. Ghi chú đăng ký đã có cơ chế giữ bản nháp tốt hơn và có thể dùng làm mẫu thiết kế.

[Hàng đợi ảnh](../src/AlbumUploadDialog.tsx#L69) nằm trong bộ nhớ; unmount hủy tải và xóa preview. Nút đóng có xác nhận, nhưng tải lại/đóng tab không qua nút này. [Cảnh báo rời trang hiện tại](../src/useClub.ts#L73) chỉ theo dõi bản nháp ghi chú đăng ký. **Ảnh đã được máy chủ xác nhận vẫn còn; phần có thể mất là danh sách/chú thích chưa lưu.**

**Sửa nhỏ nhất:** xác nhận bỏ thay đổi khi form đã được sửa; cảnh báo rời trang khi còn ảnh chưa hoàn tất. Chỉ cân nhắc phục hồi hàng đợi bằng IndexedDB sau đó, với mã thao tác tải hiện có để tránh trùng; database trực tuyến vẫn là nguồn chính.

### 5. Mở link, tải lại và Back chưa giữ đúng ngữ cảnh

**Mức ưu tiên: cao về tiện dụng, đặc biệt khi gửi link trong nhóm. Xác nhận bằng code.**

[App](../src/App.tsx#L119) chỉ đọc chính xác `#album` lúc khởi động; các mục còn lại đổi bằng state. Tải lại ở Tiền sân/CS/Du lịch về lịch; từ URL album chuyển sang mục khác rồi tải lại có thể quay về album. Chưa có link mở thẳng một buổi, bảng phí, chuyến đi hoặc ảnh.

**Sửa:** đưa mục đang xem, ID bản ghi và tuần/ngày cần thiết vào URL; xử lý Back/Forward. Thêm nút sao chép/chia sẻ link đúng nội dung.

**Nghiệm thu:** mở link ở trình duyệt khác, tải lại và bấm Back vẫn đến đúng buổi/bảng phí/chuyến đi/album. Kiểm tra riêng khi mở từ Zalo.

## Các cải tiến tiện dụng tiếp theo

| Ưu tiên | Cải tiến cụ thể | Bằng chứng và phạm vi |
| --- | --- | --- |
| Vừa | Cho cuộn trang qua cảnh 3D khi nhúng; giữ xoay/chụm đầy đủ trong toàn màn hình | [CSS cảnh](../src/albumSpace.css#L13) dùng `touch-action:none`, cảnh điện thoại cao tối thiểu 640px; [wheel](../src/AlbumSpace.tsx#L287) luôn chặn cuộn để zoom. Cần điều chỉnh cả xử lý pointer và CSS, không chỉ một thuộc tính. Giữ hiệu ứng theo yêu cầu, kiểm tra thao tác trên máy thật |
| Vừa | Tìm tên không dấu và bỏ khoảng trắng thừa | [Chọn tên](../src/QuickRegistration.tsx#L62) và [tìm thành viên](../src/App.tsx#L806) chỉ lowercase/includes. “dung”, “yen”, “my linh” nên tìm được Dũng, Yến, Mỹ Linh; vẫn phân biệt bằng ID |
| Vừa | Giữ ô nhập album dễ đọc và vùng chạm đủ lớn trên điện thoại | [CSS tìm album](../src/teamAlbum.css#L1276) là 11px, chú thích 10px và nút bỏ ảnh 22px tại [CSS uploader](../src/teamAlbum.css#L1567). Đề xuất input 16px, vùng chạm khoảng 44px; cần thử việc focus/zoom trên Safari và Zalo |
| Vừa | Nút “Đã xong” ngay trong danh sách đồ chuẩn bị | [Checklist](../src/ActivityFeatures.tsx#L1057) hiện cần mở form để đổi trạng thái. Gửi patch chỉ trường trạng thái qua RPC/version hiện có |
| Vừa | Bộ lọc “Chờ tôi phản hồi” và “Buổi tôi đi” có số lượng | [Lịch tuần](../src/App.tsx#L149) hiện lọc ngày. Hai chip cá nhân dùng dữ liệu đã tải, giúp không phải đọc từng thẻ |
| Sau | Hiển thị tên đang dùng nhất quán giữa đăng ký, CS và tài chính | [Tên đăng ký](../src/useClub.ts#L319) và danh tính xác minh là hai trạng thái độc lập. Xác minh mã chưa đồng thời chuyển tên; nên có thẻ tên rõ ràng và chuyển sang đúng tên một chạm, tránh nhầm người |
| Sau | Giảm tải dữ liệu lặp khi nhóm có nhiều lịch/chi phí | [Reload](../src/useClub.ts#L129) tải tuần tự quick → booking → activity; các snapshot lại kèm dữ liệu lịch. Có thể gộp lần đọc hoặc tải theo mục, phân trang lịch sử, vẫn giữ Realtime và lấy lại sau reconnect. Chưa đo độ trễ thực tế nên đây là tối ưu dự phòng |
| Tùy nhu cầu | Nhận ảnh HEIC từ điện thoại thuận tiện hơn | [Kiểm tra file](../src/albumUpload.ts#L72) hiện từ chối HEIC/HEIF rõ ràng. Có thể thêm bước chuyển đổi có tiến trình/fallback; chưa kiểm khả năng giải mã và hành vi chọn ảnh trên iPhone thật |

## Chỉ nên thêm vài tiện ích mới

1. **“Việc của tôi”**: gom buổi chưa trả lời, tuần mình đặt sân, khoản mình còn thiếu và yêu cầu đổi lượt cần xử lý vào một trang. Phần lớn dữ liệu đã có; lợi ích là bớt chuyển mục.
2. **“Sao chép tin nhắn nhóm”**: tạo nội dung ngắn gồm ngày/giờ/sân/người đi/tiền/link để người dùng tự dán vào Zalo. Đây là thao tác thủ công, không gửi tin nhắn tự động.
3. **Xuất CSV bảng phí/thu chi**: phục vụ đối chiếu và lưu bản chốt như bảng tính cũ. Xuất cả thời điểm chốt và trạng thái thu/hoàn; dữ liệu máy chủ vẫn là nguồn chính.

## Những phần đã có và nên giữ

- Đăng ký một chạm, nhớ tên, chọn nhiều ca với kết quả riêng, mẫu lịch và sao chép tuần.
- Ghi chú tự lưu, chờ xác nhận máy chủ, giữ bản nháp và xử lý xung đột.
- Phân công theo tuần, đổi lượt có phản hồi, người đã đặt thực tế và lịch sử riêng.
- Chia tiền theo nhóm tham gia, chia dư đến đồng, phí đã chốt giữ nguyên, lọc chưa đóng, thu đủ chống trùng, khoản thu/hoàn có lịch sử.
- Album tải nhiều file, tiến trình thật, retry/idempotency, thumbnail, Thùng rác, hai mặt ảnh, vuốt/chụm trong trình xem.
- Realtime, tải lại sau mất mạng/quay lại tab và đối soát định kỳ đã được triển khai. Lượt kiểm tra kết nối này xác nhận API hoạt động, không thay thế nghiệm thu hai thiết bị.

## Thứ tự triển khai đề nghị

**Đợt 1 — đúng và không mất công nhập:** sửa nút hoàn tiền, chuẩn hóa kết quả API/kiểm thử, phục hồi form khi xung đột và cảnh báo bỏ thay đổi.

**Đợt 2 — nhanh trên điện thoại:** URL mở đúng nội dung, chia sẻ link/tin nhắn nhóm, cuộn qua cảnh nhúng, tìm không dấu, chỉnh vùng chạm và checklist một chạm.

**Đợt 3 — dùng lâu dài:** “Việc của tôi”, xuất CSV, giảm tải snapshot và cân nhắc HEIC/phục hồi hàng đợi theo nhu cầu thực tế.
