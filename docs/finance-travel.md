# Tiền sân, thanh toán và Du lịch & sự kiện

## Cập nhật: lịch tự có bảng phí và chọn ảnh từ thiết bị

Sau khi đã chạy migration tài chính 003, chạy toàn bộ [migration 004](../supabase/migrations/202611100004_auto_fees_and_covers.sql) trong Supabase **SQL Editor**, rồi tải lại website. Bản này tạo luôn bucket `trip-covers` và chính sách upload; không cần Edge Function hoặc khóa bí mật mới.

- **Tạo lịch ở trang chủ:** khi máy chủ lưu lịch thành công, đồng thời tạo một bảng phí tạm tính trống trong **Tiền sân**. Sửa lịch không tạo trùng bảng phí. Sao chép tuần tạo bảng phí mới trống, không mang theo tiền hay khoản thu tuần cũ. Tiền sân dự kiến không tự trở thành khoản phải thu.
- **Nhiều ca/sân:** bấm **Gộp ca / sân**, chọn rõ các nhóm cùng buổi. Chỉ gộp các bảng tự tạo chưa chỉnh sửa, chưa có chi phí, khoản thu hoặc xác nhận người chịu phí riêng. Bảng đã có phát sinh bị chặn để tránh đổi công nợ; bảng nguồn và lịch sử vẫn được giữ. Chọn một ca đã có bảng trống sẽ mở chính bảng đó.
- **Ảnh chuyến đi:** trong Tạo chuyến/Thông tin, bấm **Chọn ảnh từ thiết bị**, chọn JPG/PNG/WebP tối đa 5 MB. Chờ thông báo tải lên thành công, rồi **Tạo chuyến đi/Lưu thông tin**. Trong lúc tải hoặc khi lỗi chưa được xử lý, nút lưu bị khóa; có thể thử lại hoặc bỏ ảnh vừa chọn. Ảnh HEIC/HEIF cần xuất sang JPG/PNG/WebP. Liên kết https vẫn nằm trong tùy chọn thu gọn.

Ảnh được lưu trong Supabase Storage, không lưu blob/file trong localStorage hoặc database JSON. Máy chủ cấp đường dẫn ngẫu nhiên có hiệu lực 15 phút cho đúng người có quyền; Storage chỉ cho tạo mới tại đường dẫn đó. Không đưa mã cá nhân vào tên tệp và không cho ghi đè/xóa ảnh cũ từ frontend. Bucket công khai phục vụ ảnh bìa, giới hạn kiểu ảnh và 5 MB; xem [Storage access control](https://supabase.com/docs/guides/storage/security/access-control). Sau khi tải ảnh xong, lưu chuyến đi mới phát cập nhật ảnh sang thiết bị khác. Hủy biểu mẫu sau khi upload có thể để lại tệp chưa dùng; ảnh cũ vẫn giữ để phục vụ lịch sử. Khi dọn Storage thủ công, cần kiểm tra ảnh còn được chuyến đi/lịch sử tham chiếu trước khi xóa; không xóa trực tiếp hàng `storage.objects` bằng SQL.

Bản 004 chỉ áp dụng tự động cho lịch tạo mới, giữ nguyên các bảng phí/lịch sử cũ. Lịch cũ chưa có bảng phí vẫn có thể chọn trong biểu mẫu để tạo bảng phí thủ công. Migration không khởi tạo chi phí hay công nợ lịch sử.

**Kiểm tra bản cập nhật này:** `npm run build` thành công và `npm test` đạt 199/199 trường hợp, gồm kiểm thử tự tạo/gộp bảng phí, rollback, quyền upload, xung đột biểu mẫu và xuất dữ liệu. Trước khi triển khai frontend mới, chạy [migration practical updates](../supabase/migrations/202611110003_practical_updates.sql) sau tài chính 003 và sau migration 004 nếu đã cài; migration này sửa giá trị `can_manage` về boolean, trả HTTP 409 cho xung đột nghiệp vụ và thêm API snapshot gộp. Kết quả tự động không chứng minh đã kiểm tra upload tệp thật hoặc Realtime giữa hai danh tính trên Supabase; các bước này vẫn cần nghiệm thu trực tiếp.

## Bật trên Supabase hiện tại

1. Giữ nguyên URL/key và dữ liệu đang có. Nếu đã dùng **Phân công CS**, mở [migration tài chính mới](../supabase/migrations/202611100003_finance_travel.sql).
2. Vào **Supabase → SQL Editor → New query**, dán **toàn bộ** nội dung migration mới, bấm **Run**. Khóa công khai trong frontend không có quyền tạo bảng; cần tài khoản chủ dự án trong SQL Editor.
3. Khi thành công, mở website và bấm **Tải lại dữ liệu**. Không chạy lại migration cũ sau bản mới: định nghĩa API cũ có thể ghi đè phiên bản tính năng.
4. Trong terminal VS Code:

   ```sh
   npm run check:connection
   npm run check:finance-access
   npm run dev
   ```

Dự án hoàn toàn mới cần chạy các migration theo thứ tự: ban đầu → đăng ký nhanh → phân công CS → tài chính. Xem [README](../README.md) và [hướng dẫn CS](./booking-responsibility.md) để thiết lập admin/mã cá nhân. Chạy lại **migration tài chính mới** không tạo trùng dữ liệu. Migration không tạo chuyến đi, khoản chi/thu mẫu hoặc nhập lịch sử Sheets.

Triển khai: `npm run build`, đưa `dist` lên hosting đang dùng; giữ hai biến công khai trong [.env.example](../.env.example) ở môi trường build. Backend cần chạy migration trước. Không đưa khóa quản trị vào frontend.

## Danh tính và quyền

- Admin dùng Supabase Auth hiện có. Thành viên dùng **mã cá nhân một lần**, admin cấp tại **Phân công CS → Vòng phân công → Cấp mã**. Không cần email cho thành viên dùng mã.
- Mã này dùng chung cho đặt sân, du lịch và tài chính. Chọn tên đánh cầu nhanh không cấp quyền tài chính.
- Thành viên đã xác minh xem tài chính, sửa đăng ký/ghi chú của mình và khách mình mời. Không tự xác nhận đã trả tiền.
- Người phụ trách quản lý chi phí, người chịu phí, chốt phí và khoản thu của hoạt động được giao. Admin quản lý toàn bộ; chỉ admin được sửa số suất giảm hoặc đổi người phụ trách tài chính.
- Bảng phí cầu lông mặc định kế thừa người phụ trách các ca/sân. Nếu nhiều nhóm khác người phụ trách, admin chỉ định người thu chung trong **Thông tin**. Quyền kế thừa theo phân công sân mới; chỉ định riêng giữ theo chỉ định.

## Cầu lông: thao tác

1. **Tiền sân → Tạo bảng phí**: chọn ngày, các dòng ca/sân và cơ sở chia **theo ca** hoặc **theo nhóm từng sân**. Thứ tự chọn là thứ tự nhóm. Mỗi dòng lịch thuộc tối đa một bảng phí để tránh tính trùng.
2. **Khoản chi**: thêm tiền sân riêng từng nhóm, tiền cầu và khoản chung có tên rõ ràng. Tiền sân bắt buộc gắn nhóm.
3. Khi thêm tiền cầu có lựa chọn **Tiền cầu tính vào ca 1** (tên theo nhóm đầu tiên). Chọn **Chung cả buổi** để chia cho người duy nhất tham gia ít nhất một nhóm.
4. **Chia tiền → Xác nhận người chia**: mặc định lấy người chọn Đi. Đánh dấu người thực tế chịu phí không sửa đăng ký gốc. **Theo đăng ký** bỏ xác nhận riêng.
5. Kiểm tra công thức, người chia và cảnh báo rồi **Chốt tiền**. Máy chủ chặn chốt khi chưa có người chịu phí hoặc có chi phí chưa phân bổ.
6. Sau khi nhận tiền, bấm **Đã thu đủ** trên dòng thành viên. Máy chủ tự tính số còn thiếu; bấm lại không tạo khoản thu trùng. Thu một phần, thu dư và hoàn tiền dùng **Thu / hoàn**.
7. Trong **Thu & hoàn**, điều chỉnh khoản ghi nhầm cần lý do: bản cũ được hủy và bản thay thế tạo trong một giao dịch; lỗi thì hoàn tác cả hai. Hủy khoản tiền cũng giữ dấu vết, người hủy và lý do.

### Chia và chốt

Tiền sân mỗi nhóm chia riêng; người đi hai ca trả hai phần. Khoản chung chia theo tập hợp người duy nhất. Không suy đoán ca và sân là cùng một nhóm.

Mọi số tiền là đồng nguyên, tính ở PostgreSQL. Từng khoản được chia lấy phần nguyên, phần dư phân bổ theo thứ tự ID ổn định. Tổng nghĩa vụ bằng tổng chi phí. Ví dụ **250.000 + 145.000 / 10 người = 39.500đ/người** (cộng chi phí trước khi chia).

Trong **Thông tin**, có lựa chọn làm tròn tổng nghĩa vụ mỗi người lên 1.000đ. Giao diện hiển thị rõ tổng phải thu và khoản thu dư; không giấu vào chi phí.

**Tạm tính** theo dữ liệu mới nhất. **Đã chốt** giữ riêng người, nhóm, số tiền và phân bổ từng khoản; đăng ký đổi sau đó không sửa công nợ. Muốn điều chỉnh: **Mở lại bảng phí**, nhập lý do, sửa và chốt lại. Các khoản thu/bản chốt cũ vẫn còn. Người đã đóng bị bỏ khỏi danh sách sau điều chỉnh có nghĩa vụ 0đ và vẫn có dòng để hoàn tiền.

Trạng thái: Không phát sinh / Chưa thanh toán / Thanh toán một phần / Đã thanh toán / Thu thừa. Nghĩa vụ 0đ không tính vào số người cần thanh toán. Có bộ lọc người chưa đóng/thiếu; số dư âm được ghi **Cần hoàn lại** với số tiền dương.

## Du lịch & sự kiện

Admin tạo chuyến, giao người phụ trách, nhập ảnh bìa bằng URL https, mô tả, địa điểm/bản đồ, ngày đi/về, lịch trình từng ngày, ngân sách và hạn xác nhận. Sau khi tạo, chuyển **Mở đăng ký** trong **Thông tin**. Thành viên thường chỉ sửa đăng ký khi còn mở và còn hạn.

Người đi cùng là dòng riêng liên kết người mời; trùng tên khách dưới cùng người mời bị chặn. Hai người thật sự cùng tên cần tên hiển thị phân biệt. Không tạo khách thành tài khoản mới. Mặc định mỗi người 1 suất. Admin được đặt 0–100 suất, tối đa ba chữ số lẻ; khác 1 suất cần lý do. Hiện riêng số người thực tế và tổng suất chia. Không đi/Chưa phản hồi không tự bị tính tiền.

### Chi phí và chuẩn bị

Mỗi khoản gồm nhóm chi, dự toán, thực tế, nguồn chi, người ứng và ghi chú. Các nhóm: chỗ nghỉ, thuê đồ/dụng cụ ăn, đồ ăn/uống, di chuyển, vé/hoạt động, khoản khác. Chọn **Chỉ những người được chọn** nếu khoản chỉ áp dụng một nhóm. Máy chủ chia theo suất của người xác nhận Đi và chịu phí trong nhóm đó.

Quỹ dự phòng nằm riêng trong **Thông tin**. Dự kiến cần thu = dự toán + dự phòng. Quyết toán chỉ dùng chi phí thực tế; dự phòng chưa sử dụng không là chi phí. Chi từ dự phòng cần tạo khoản chi thực tế. Số dư quỹ, ứng chưa hoàn và thống nhất hoàn/giữ lại tiền dư hiển thị riêng; không tự chuyển dư thành chi phí.

**Chuẩn bị** gồm đồ, số lượng, đơn vị, người chuẩn bị, trạng thái, ghi chú và liên kết khoản chi tùy chọn. Danh sách này không tự sinh chi phí; liên kết không cộng khoản chi lần thứ hai.

### Thu trước, bổ sung, hoàn tiền và ứng cá nhân

Mỗi lần thu/hoàn là một dòng sổ tiền, có thời gian và người xác nhận:

```
Đã đóng ròng = Thu trước + Thu bổ sung − Tiền hoàn
Còn phải đóng = Nghĩa vụ sau quyết toán − Đã đóng ròng
```

Nếu kết quả âm: **Cần hoàn lại**. Ví dụ **8.907.000đ / 12 = 742.250đ/người**; đã đóng 555.000đ thì còn **187.250đ/người**. Khách đổi sang Không đi sau khi đã đóng vẫn có dòng để hoàn tiền.

| Tình huống                       | Ghi nhận                                         |
| -------------------------------- | ------------------------------------------------ |
| Thành viên đóng vào quỹ          | Thu trước / Thu bổ sung theo dòng người tham gia |
| Cá nhân trả cho homestay, mua đồ | Khoản chi → Cá nhân ứng trước → chọn người ứng   |
| Quỹ trả lại khoản ứng            | Sổ tiền → Quỹ hoàn tiền ứng                      |

Tiền ứng không là tiền đóng quỹ. Hoàn ứng không tạo chi phí lần hai. Máy chủ chặn hoàn ứng vượt số còn ứng và hoàn tiền đóng vượt tiền đóng ròng. Khoản ứng đã hoàn cần hủy bản hoàn ứng liên quan trước khi sửa tiền/người ứng. Khoản thu đã được hoàn một phần cũng cần xử lý bản hoàn trước khi hủy khoản thu gốc.

Số dư quỹ = đóng ròng − chi từ quỹ − hoàn ứng đã ghi nhận. Khoản chi **Chưa ghi nhận nguồn chi** vẫn tính vào nghĩa vụ nhưng không giả định quỹ đã trả; cập nhật đúng nguồn chi để đối chiếu quỹ.

## Dữ liệu, đồng bộ và lịch sử

| Bảng                                     | Nội dung                                                        |
| ---------------------------------------- | --------------------------------------------------------------- |
| `club_activities`, `activity_groups`     | Hoạt động, người phụ trách, nhóm ca/sân, trạng thái phí         |
| `activity_billable`, `trip_participants` | Xác nhận chịu phí, đăng ký, khách, suất chia, phiên bản ghi chú |
| `activity_expenses`                      | Dự toán/thực tế, phạm vi, nguồn chi, người ứng; hủy mềm         |
| `activity_ledger`                        | Khoản thu/hoàn, mã thao tác duy nhất, xác nhận và dấu hủy       |
| `activity_finalizations`                 | Các bản chốt bất biến                                           |
| `trip_checklist`, `finance_history`      | Chuẩn bị và lịch sử trước/sau, người sửa, thời gian, lý do      |

Tất cả bảng mới bật RLS và chặn đọc/ghi trực tiếp từ trình duyệt. RPC `SECURITY DEFINER` có `search_path` cố định và kiểm tra danh tính/quyền/phiên bản. Khách chưa xác minh không nhận sổ tiền, đăng ký du lịch hoặc lịch sử tài chính.

Mọi thay đổi phát tín hiệu qua `booking_sync` đã có trong publication `supabase_realtime`; kênh công khai không mang token hoặc nội dung tài chính. Trình duyệt nhận tín hiệu rồi tải snapshot theo quyền, cập nhật cả thêm/sửa/xóa. Snapshot công thức và danh sách đăng ký lấy cùng một lần đọc SQL. Mở trang, nối mạng, Realtime kết nối lại, quay lại tab và đối soát định kỳ đều lấy dữ liệu mới nhất.

Đăng ký cầu lông và chốt tiền dùng chung thứ tự khóa giao dịch. Thu đủ khóa hoạt động, tính số thiếu tại máy chủ. Thu thủ công giữ mã thao tác khi retry để không tạo trùng sau lỗi mạng. Các biểu mẫu chỉ gửi trường vừa sửa và phiên bản gốc; xung đột được báo và giữ nội dung đang nhập để đối chiếu. Mất mạng khóa thao tác; Đã lưu chỉ hiện sau xác nhận RPC.

## Kiểm tra

Kết quả bản **003 trước cập nhật 004**: **68/68** kiểm thử toàn dự án đạt, gồm **13** kiểm thử PostgreSQL/PGlite và **8** kiểm thử giao diện cho tài chính/du lịch. Đây là kết quả lịch sử; lượt kiểm tra hiện tại đạt **199/199** kiểm thử toàn dự án và build thành công, bao gồm cả các thay đổi sau 004. Bảng phí có 10 người được kiểm tra bố cục riêng ở 320/375/390/768/1024/1440px; không tràn ngang. Các kiểm thử không sửa dữ liệu nhóm. Chưa nghiệm thu upload thật và đồng bộ hai thiết bị trên Supabase sau khi chạy các migration.

`npm test` kiểm tra PostgreSQL cục bộ bằng PGlite và giao diện React với dữ liệu kiểm thử riêng, không ghi Supabase thật. `npm run build` kiểm tra TypeScript/build. `npm run check:finance-access` dùng các mục tiêu không tồn tại để kiểm tra quyền trên Supabase thật, không sửa dữ liệu nhóm.

Nghiệm thu hai phiên thật sau khi chạy SQL và cấp hai danh tính:

1. A phụ trách tạo bảng phí thử trên một lịch thử, thêm/sửa chi phí; B thấy tổng đổi không tải lại.
2. B đổi đăng ký; A thấy tạm tính mới. A chốt; B đổi lại đăng ký không được đổi công nợ đã chốt.
3. A thu một phần rồi thu đủ, bấm lại; B thấy tiền và trạng thái đúng, số dòng thu không tăng khi không còn thiếu.
4. Thử điều chỉnh/hủy/hoàn, đối chiếu lịch sử. B là thành viên thường không được xác nhận thu hoặc sửa ghi chú người khác.
5. Chuyến thử có khách 0,5 suất, khoản chi riêng, thu trước, cá nhân ứng và hoàn ứng; đối chiếu ba luồng tiền.
6. Ngắt mạng B, A sửa dữ liệu, nối lại B phải tự cập nhật đầy đủ; tải lại vẫn đúng dữ liệu.
7. Hai phiên sửa cùng ghi chú: phiên sau phải đối chiếu xung đột, không tự mất nội dung.

Kiểm thử PostgreSQL cục bộ không thay thế nghiệm thu Realtime bằng hai danh tính trên Supabase thật. Khi chưa có migration/mã cá nhân, website báo cần cấu hình; không mô phỏng tiền hoặc đồng bộ. Sheets chỉ làm tham chiếu; không nhập lịch sử. Chưa tích hợp ngân hàng, QR, tự xác nhận chuyển khoản hoặc Zalo.
