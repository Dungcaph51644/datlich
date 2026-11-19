# Trợ lý AI của nhóm cầu lông

Chatbot nằm ở góc dưới bên trái, dùng xanh rừng/lime cùng giao diện hiện tại. Có gợi ý câu hỏi, nhập tiếng Việt, trạng thái chờ, nguồn chi tiết, thu nhỏ, đóng, xác nhận xóa, thử lại, giới hạn ký tự và trạng thái mất mạng. Tin nhắn chỉ giữ trong bộ nhớ tab, tối đa 40 tin; tải lại hoặc đổi tên/danh tính sẽ xóa nội dung. Không lưu lịch sử chat vào localStorage hoặc database.

## Kiến trúc và quyền

`ClubChat` → `useClub.askChat` → Supabase Edge Function `club-chat` → RPC `get_chat_context` → lớp `ChatModel` → OpenAI Responses API. Mỗi câu hỏi lấy lại dữ liệu, không dùng dữ liệu tài chính/lịch cũ từ câu trả lời trước. Chỉ tối đa bốn câu hỏi người dùng trước đó được gửi để hiểu câu hỏi tiếp; câu trả lời trước không làm bằng chứng.

- Tận dụng bảng `sessions`, `members`, `attendance`, `weekly_booking_assignments`, các bảng tài chính/du lịch và hàm `private.finance_calculate` đang có. Bảng phí đã chốt dùng `final_summary`, không tính lại theo số đăng ký mới.
- Chọn tên chỉ là đối tượng tra cứu cho “tôi”. Không có tên thì yêu cầu chọn tên; tên không hoạt động thì yêu cầu chọn lại. Không tự thay tên theo tài khoản đang đăng nhập.
- JWT tài khoản và token mã cá nhân được chuyển tới RPC theo cơ chế xác minh hiện tại. Chỉ người đã xác minh mới đọc chi phí, khoản thu và người tham gia du lịch, giống API hiện có; khách đọc lịch, phân công và tóm tắt chuyến công khai. Chọn tên không cấp thêm quyền.
- Service role chỉ gọi `reserve_chat_request` để quản lý hạn mức, **không** dùng để đọc dữ liệu nhóm. Khóa API mô hình, JWT và token cá nhân không đi vào prompt hoặc log.
- RPC chỉ trả trường cần thiết của tối đa 8 buổi/hoạt động, 24 người, 12 khoản chi mỗi hoạt động. Không lấy snapshot toàn database. Các phần bị giới hạn có cờ rõ ràng; mô hình không được suy luận tổng toàn nhóm từ phần dữ liệu thiếu.
- Câu hỏi hỗ trợ tuần/tháng này/sau/trước, hôm nay/mai/qua, thứ trong tuần, ngày `dd/mm/yyyy` hoặc `yyyy-mm-dd`, và buổi/hoạt động đang mở. Ngày theo Việt Nam (UTC+7). Câu hỏi không chỉ rõ ngày mặc định lịch tuần này; tài chính/du lịch trong 90 ngày trước đến 180 ngày tới; câu “tôi còn thiếu” không nêu ngày tra cứu các hoạt động liên quan đã lưu và báo giới hạn nếu có hơn 8 hoạt động. Câu hỏi nhiều ngày cụ thể yêu cầu hỏi từng buổi để tránh ghép nhầm bảng phí.
- Phiên bản đầu chỉ hỏi đáp/hướng dẫn. Không cung cấp công cụ ghi dữ liệu cho mô hình. Đăng ký/sửa lịch/thanh toán đều mở đúng trang chức năng; backend hiện có tiếp tục quyết định quyền.
- Nội dung trả lời hiển thị bằng React text, không render HTML/Markdown từ mô hình. Nút nguồn chỉ dùng đường dẫn nội bộ do backend tạo; ID nguồn ngoài danh sách bị từ chối.

## Cấu hình và triển khai

1. Trong Supabase SQL Editor, chạy toàn bộ [migration chatbot](../supabase/migrations/202611190002_club_chat.sql) sau các migration phân công, tài chính 003 và tự tạo bảng phí 004 đang dùng. Migration không sửa lịch/chi phí/biên nhận có sẵn, có thể chạy lại.
2. Mở [trang API keys của OpenAI](https://platform.openai.com/api-keys), đăng nhập bằng tài khoản OpenAI của bạn. Tạo/chọn project cho chatbot → **Create new secret key** → đặt tên, ví dụ `caulong-chatbot` → sao chép key để nhập trực tiếp vào Supabase ở bước sau. Đảm bảo project/organization có tín dụng API và quyền dùng model. Không gửi key qua chat, không dán vào mã nguồn hoặc Netlify frontend, không dùng biến có tiền tố `VITE_`. Cấu hình mẫu nằm trong [biến môi trường phía máy chủ](../supabase/functions/.env.example).
3. Supabase Dashboard → **Edge Functions → Secrets**, thêm:

   ```dotenv
   OPENAI_API_KEY=<key của project OpenAI>
   AI_PROVIDER=openai
   AI_MODEL=gpt-6-luna
   AI_BASE_URL=https://api.openai.com/v1
   AI_MAX_OUTPUT_TOKENS=800
   CHAT_ALLOWED_ORIGINS=https://caulongteam.netlify.app
   ```

   Mỗi dòng là một secret: phần trước dấu `=` là **Name/Key**, phần sau là **Value**. Thay phần `<key của project OpenAI>` bằng key thật rồi bấm **Save**. Nếu đã có `AI_MODEL` hoặc `AI_MAX_OUTPUT_TOKENS` cũ, sửa giá trị đó; secret đã lưu được ưu tiên hơn mặc định trong source. [Supabase áp dụng thay đổi secret ngay, không cần deploy lại chỉ vì đổi secret](https://supabase.com/docs/guides/functions/secrets).

   Khi thử Vite, thêm đúng origin vào `CHAT_ALLOWED_ORIGINS`, phân cách bằng dấu phẩy. Vite có thể chuyển sang 5174/5175 khi 5173 đang dùng; `localhost` và `127.0.0.1` là hai origin khác nhau. Ví dụ dùng website chính và trang local hiện tại: `https://caulongteam.netlify.app,http://127.0.0.1:5174`. Mẫu env có sẵn các cổng 5173–5175. Không dùng wildcard. Hosted Supabase cung cấp sẵn `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Có thể dùng `CHAT_SUPABASE_PUBLISHABLE_KEY` để thay public key cũ. Không đưa service role xuống Netlify frontend.

4. Chạy SQL chỉ tạo phần database; chưa triển khai mã Edge Function. Nếu chưa có function `club-chat`, hoặc cần cập nhật source, mở terminal trong thư mục dự án và chạy bằng Supabase CLI:

   ```sh
   supabase login
   supabase functions deploy club-chat --project-ref bzxlfayydfwljjccexub
   ```

   [Cấu hình function](../supabase/config.toml) đặt `verify_jwt=false` để khách có thể hỏi lịch. Handler chỉ cho origin đã cấu hình; JWT người dùng vẫn do PostgREST xác minh, quyền dữ liệu do RPC kiểm tra. CORS không phải cơ chế xác thực hoặc chặn bot; hạn mức toàn cục mới là chốt kiểm soát chi phí. Không sửa `verify_jwt` của function khác.

5. Chạy `npm run build`, triển khai frontend mới lên Netlify. Hai biến Supabase frontend giữ nguyên; không có API key mô hình trong build frontend.
6. Mở chat, thử lịch tuần này, tên chưa chọn, tên khác danh tính đã xác minh, buổi hủy, câu hỏi tiền chưa chốt, một người đã thu/hoàn, câu hỏi không có dữ liệu, retry và đổi tên khi đang chờ. Bấm nguồn phải mở đúng buổi/bảng phí/chuyến.

Hạn API mô hình hoặc key không hợp lệ trả lỗi, không thay bằng câu trả lời bịa. Thiếu migration/Edge Function/key sẽ hiển thị rõ trợ lý chưa được cấu hình. Nếu tùy chỉnh nhà cung cấp, triển khai interface `ChatModel` tại [lớp mô hình](../supabase/functions/_shared/chat/model.ts); backend/SQL và UI không cần thay. `AI_BASE_URL` chỉ dùng cho API hỗ trợ đúng schema Responses, không phải mọi endpoint chat-completions đều tương thích.

## Khi báo chưa kết nối được trợ lý

Kiểm tra ngày 19/11/2026: RPC `get_chat_context` trên Supabase thật trả **200, version 1**; Edge Function `club-chat` trả **404, NOT_FOUND, Requested function was not found** cho cả website chính và trang local 5174. SQL đã cài, nhưng function chưa được triển khai. Lưu Secrets hoặc chạy SQL không tự triển khai function.

Từ thư mục dự án, đăng nhập Supabase CLI và triển khai đúng tên function:

```sh
npx supabase login
npx supabase functions deploy club-chat --project-ref bzxlfayydfwljjccexub
```

Nếu đã cài CLI toàn cục, bỏ tiền tố `npx`. Lệnh deploy dùng [cấu hình function](../supabase/config.toml) và kèm các file trong `_shared/chat`; không tạo một function trống trong Dashboard. Xem [triển khai Edge Function](https://supabase.com/docs/guides/functions/deploy). Sau deploy, trong **Edge Functions → Secrets**, sửa `CHAT_ALLOWED_ORIGINS` thành `https://caulongteam.netlify.app,http://127.0.0.1:5174` để thử cả hai địa chỉ. Giữ API key/model hiện có. Cổng local khác cần thêm đúng cổng đó. Trên Netlify, triển khai frontend mới để nhận vị trí bên trái và thông báo chẩn đoán mới.

Kiểm tra không dùng token AI hoặc sửa dữ liệu:

```sh
npm run check:chat-access -- http://127.0.0.1:5174
```

Kết quả đạt: OPTIONS trả 200/204 và đúng origin được phép (hoặc `*` ở gateway); câu hỏi “tôi” chưa chọn tên trả 200 và `needsMember: true`; RPC trả version 1. Sau đó thử câu hỏi lịch thật để kiểm chứng key, billing, quyền truy cập model và phản hồi AI. Bài kiểm tra kết nối không xác nhận các phần này.

Trình duyệt chặn POST nếu OPTIONS bị 404, nên SDK có thể chỉ báo lỗi kết nối chung. Frontend mới dùng thêm GET đơn giản khi lỗi mạng để phát hiện thiếu function; không gửi key, mã cá nhân hoặc nội dung câu hỏi qua bước này, không gọi mô hình. HTTP 404 sẽ hiển thị rõ trợ lý chưa được triển khai. CORS/mạng không đọc được trạng thái sẽ hướng dẫn kiểm tra máy chủ và địa chỉ được phép, không khẳng định lỗi do mạng thiết bị.

Đã xác nhận trên trình duyệt local 5174: gửi câu hỏi gặp preflight 404 và thông báo mới “Trợ lý AI chưa được triển khai trên máy chủ”. Nút/khung chat ở trái, không tràn ngang tại 320/390/1440px (lề 12px trên điện thoại, 20px desktop). 13 bài kiểm thử client/handler/UI liên quan và TypeScript/build đạt. Chưa xác nhận câu trả lời mô hình thật khi function chưa deploy.

## Có thể dùng tài khoản ChatGPT đang có không?

Bạn có thể dùng cùng tài khoản/email để đăng nhập OpenAI API Platform và tạo API key. Website gọi API bằng key phía máy chủ; việc đang đăng nhập ChatGPT không tự cấp quyền cho website dùng model, và không nhập mật khẩu/cookie ChatGPT vào chatbot.

Theo [quyền lợi API credits chính thức](https://developers.openai.com/api/docs/guides/chatgpt-api-credits), tại lần kiểm tra 19/11/2026, **Plus, Go và Free không thuộc diện nhận tín dụng API này**. Gói **Pro hoặc Business trả phí đủ điều kiện**, đã hoạt động ít nhất 7 ngày, có thể nhận tín dụng API: dùng cùng email, sở hữu subscription/workspace và API organization được liên kết. Vào **ChatGPT → Settings → Billing → API credits** (hoặc API Platform → Billing), chọn organization và kích hoạt quyền lợi nếu có. Tạo key trong đúng organization đã nhận credit. Hạn mức tùy gói, credit hết hạn theo chu kỳ thanh toán; ngoài quyền lợi này, API tính phí riêng theo lượng dùng. Không cần nâng gói ChatGPT chỉ để bật chatbot; có thể mua tín dụng API trong [Billing](https://platform.openai.com/settings/organization/billing/overview).

## Chi phí và giới hạn

Mặc định dùng `gpt-6-luna`, reasoning `none`, Responses API `store:false`, không dùng tìm kiếm web/file hoặc nhiều lượt tool. Theo [giá GPT-6 Luna chính thức](https://developers.openai.com/api/docs/models/gpt-6-luna), giá Standard tại lần kiểm tra 19/11/2026 là **0,10 USD/triệu token đầu vào và 0,50 USD/triệu token đầu ra**: bằng 1/10 giá mỗi token đầu vào/đầu ra của [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) cấu hình trước đây. Ví dụ 3.000 token đầu vào + 400 token đầu ra khoảng **0,0005 USD/lượt**, hay **0,50 USD/1.000 lượt**, chưa gồm Supabase và hạ tầng. Đây là minh họa theo token thực tế, không phải giá cố định. Kiểm tra giá/quyền truy cập model trong tài khoản trước khi bật; chưa kiểm chứng chất lượng model thật khi chưa gắn key.

Model nhỏ hơn giảm giá mỗi token, không bảo đảm tự dùng ít token hơn. Cấu hình đã giảm trần đầu ra từ 1.200 xuống **800 token**, tắt reasoning và chỉ gửi dữ liệu theo câu hỏi. Trần này không có nghĩa mỗi lượt dùng đủ 800 token; nếu thường xuyên báo chưa hoàn tất do chạm trần, tăng `AI_MAX_OUTPUT_TOKENS` lên 1.200. Có thể thử 600 để tiết kiệm thêm, nhưng câu trả lời có danh sách dài dễ bị thiếu và phải thử lại.

- 800 ký tự/câu hỏi, tối đa 4 câu hỏi trước, request tối đa 10.000 byte.
- Prompt dữ liệu tối đa 18.000 ký tự; vượt ngưỡng yêu cầu thu hẹp ngày/buổi, không cắt JSON âm thầm. Output mặc định 800 token, cấu hình bị chặn trong 600–2.000.
- Trình duyệt giãn cách gửi ít nhất 3,5 giây. PostgreSQL áp dụng cửa sổ cố định 6 lượt/phút và 40/ngày theo IP đã băm; toàn nhóm tối đa 40/phút và 300/ngày. Dùng chung Wi-Fi có thể chung hạn IP. Header IP phụ thuộc gateway, nên không coi hạn từng IP là chốt duy nhất; tổng toàn nhóm vẫn áp dụng dù đổi IP.
- Đếm lượt **trước khi gọi mô hình**, không hoàn lượt lỗi để tránh retry vô hạn gây chi phí. Lỗi giới hạn trả HTTP 429 và `Retry-After`. Bảng riêng chỉ lưu bộ đếm/hash, không lưu IP gốc hay tin nhắn; bản ghi quá hai ngày được dọn trong lần gọi tiếp.
- Timeout DB 10 giây, mô hình 40 giây, UI 55 giây. Đóng/xóa/đổi danh tính ngăn nhận phản hồi cũ; một request đã tới nhà cung cấp vẫn có thể bị tính phí dù trình duyệt ngừng chờ.
- `store:false` tắt lưu Responses để truy xuất lại; không phải cam kết zero retention của nhà cung cấp. Tuân theo [chính sách dữ liệu API](https://developers.openai.com/api/docs/guides/your-data).

## Kiểm tra và giới hạn nghiệm thu

```sh
npm run test:chat
npm run check:chat-types
npm run check:chat-live
npm run build
```

`check:chat-live` chỉ đọc Supabase thật, nạp các trường công khai cần thiết vào PostgreSQL tạm trong bộ nhớ rồi chạy RPC mới. Không gửi dữ liệu thật tới mô hình, không ghi dữ liệu nhóm lên Supabase. Đối chiếu thời gian/sân/đăng ký/chỗ trống/hủy và phân công tuần hiện tại; kiểm tra thay đổi lịch và không có bản ghi trong bản sao tạm.

Lần kiểm tra tự động 19/11/2026: đọc được **18 thành viên, 3 buổi, 17 đăng ký; 1 buổi đã hủy**, khớp RPC mới trong bản sao. Khi kiểm tra đó, Supabase thật chưa có migration chatbot; sau đó người vận hành cho biết đã chạy Supabase, chưa đối chiếu lại trạng thái live. Các bài PostgreSQL kiểm tra dữ liệu nháp/chốt, chia sân/cầu theo hàm hiện có, thu ròng/hoàn, quyền chọn tên so với mã xác minh, lịch mới nhất, thiếu dữ liệu và hạn mức. Các bài handler dùng mô hình thay thế để kiểm tra giao thức/nguồn/lỗi; không xác nhận chất lượng câu trả lời của OpenAI thật.

Kiểm tra kết nối tiếp theo cùng ngày đã xác nhận migration chatbot hoạt động (RPC trả version 1), còn Edge Function chưa deploy (404). Cần triển khai function/frontend và xác nhận secret/billing/model trước khi nghiệm thu phản hồi AI thật, CORS production, hạn mức production và tài chính bằng danh tính đã xác minh trên Supabase thật. Không coi dữ liệu kiểm thử cục bộ là giao dịch thật hoặc coi trả lời từ mô hình thay thế là phản hồi AI production.
