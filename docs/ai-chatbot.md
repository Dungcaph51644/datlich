# Trợ lý nhóm cầu lông

Chatbot nằm ở góc dưới bên trái, dùng xanh rừng/lime cùng giao diện hiện tại. Có gợi ý câu hỏi, nhập tiếng Việt, trạng thái chờ, nguồn chi tiết, thu nhỏ, đóng, xác nhận xóa, thử lại, giới hạn ký tự và trạng thái mất mạng. Tin nhắn chỉ giữ trong bộ nhớ tab, tối đa 40 tin; tải lại hoặc đổi tên/danh tính sẽ xóa nội dung. Không lưu lịch sử chat vào localStorage hoặc database.

## Bật chế độ miễn phí, không cần key AI

Chế độ `lookup` trả lời theo mẫu từ dữ liệu Supabase mới nhất, **không gọi OpenAI/Gemini hoặc mô hình bên ngoài**, không phát sinh phí token. Đây là chế độ mặc định khi chưa có `AI_PROVIDER`. Nếu đã lưu `AI_PROVIDER=openai` trước đó, phải sửa secret này để chuyển sang miễn phí. Key OpenAI cũ có thể giữ hoặc xóa; không được sử dụng ở chế độ `lookup`.

1. Mở Supabase project → **Edge Functions → Secrets**. Sửa hoặc thêm đúng hai secret:

   | Name                   | Value                                                   |
   | ---------------------- | ------------------------------------------------------- |
   | `AI_PROVIDER`          | `lookup`                                                |
   | `CHAT_ALLOWED_ORIGINS` | `https://caulongteam.netlify.app,http://127.0.0.1:5174` |

   Nhập phần Name và Value vào hai ô tương ứng rồi **Save**. Nếu dùng cổng local khác, sửa/thêm đúng origin của trang đó. Không cần tạo API key, mua tín dụng hoặc nâng gói ChatGPT. Các biến `AI_MODEL`, `AI_BASE_URL`, `AI_MAX_OUTPUT_TOKENS` không dùng trong chế độ này. Các khóa Supabase có sẵn giữ nguyên.

2. Mở Terminal trong thư mục dự án và triển khai backend mới:

   ```sh
   cd /Users/macbook/datlich
   npx supabase functions deploy club-chat --project-ref bzxlfayydfwljjccexub
   ```

   Nếu CLI yêu cầu đăng nhập, chạy `npx supabase login` rồi deploy lại. **Đổi secret thôi chưa đủ** nếu server vẫn chạy bản cũ chưa có `lookup`. Supabase hiện đã có RPC chatbot; thay đổi này không cần SQL migration mới.

3. Tải lại trang local. Triển khai bản frontend mới lên Netlify để nhận nhãn “Trợ lý nhóm” và dòng “Tra cứu dữ liệu nhóm, không gọi dịch vụ AI” sau câu trả lời. Có thể dùng `npm run build` rồi triển khai thư mục build `dist` theo quy trình đang dùng.
4. Thử “Tuần này đánh hôm nào?”, “Ai đặt sân tuần sau?”, “Buổi thứ Ba còn mấy chỗ?”, “Tiền sân và tiền cầu chia thế nào?”. Với “Tôi còn thiếu bao nhiêu?”, chọn tên và xác minh mã cá nhân/tài khoản theo quyền website. Bấm nguồn để mở đúng buổi/bảng phí/chuyến.

Trợ lý miễn phí hiểu các mẫu câu về lịch, phân công, đăng ký, chi phí, thanh toán, du lịch và hướng dẫn thao tác; không trò chuyện mở như một mô hình AI. Câu chưa hiểu sẽ gợi ý mẫu câu. Không tự đăng ký, đổi lịch hoặc xác nhận thanh toán. Chi phí lấy từ phép tính đã có trên server, không tự chia lại; bảng nháp không cộng vào tổng đã chốt. Dữ liệu thiếu/bị giới hạn không được coi là không nợ hoặc đã thanh toán.

Miễn phí ở đây là **không tốn phí AI/token**; Supabase và Netlify vẫn áp dụng hạn mức gói của bạn. Giữ giới hạn gửi hiện có (6/phút, 40/ngày theo IP băm; toàn nhóm 40/phút, 300/ngày) để bảo vệ hạ tầng. Phản hồi HTTP có `mode: "lookup"` là xác nhận backend đã chọn đúng chế độ; không dựa vào việc nút chat có hiện hay không để kết luận.

Kiểm tra code bằng `npm run test:chat`, `npm run check:chat-types`, `npm run build`. `npm run check:chat-live` đối chiếu dữ liệu thật công khai với bộ trả lời miễn phí, không gọi AI hoặc ghi dữ liệu nhóm. Chỉ nghiệm thu backend đã deploy sau khi gửi câu hỏi thành công và thấy `mode: "lookup"` trong response thực tế.

Đã kiểm tra ngày 19/11/2026: **39 kiểm thử chatbot đạt**, TypeScript ứng dụng/backend và build frontend đạt. Đọc Supabase thật được **18 thành viên, 3 buổi, 17 đăng ký**, đối chiếu bộ trả lời miễn phí đúng 3 buổi, gồm 1 buổi đã hủy; RPC công khai thật chạy được với bộ trả lời mới. Lịch thay đổi, nháp/chốt, thu ròng/hoàn, quyền tài chính, thiếu thông tin và giới hạn gửi được kiểm tra trong PostgreSQL tạm hoặc mô phỏng HTTP. Chưa triển khai bản `lookup` lên Edge Function thật, chưa nghiệm thu luồng tài chính với tài khoản thật trên production.

## Kiến trúc và quyền

`ClubChat` → `useClub.askChat` → Supabase Edge Function `club-chat` → RPC `get_chat_context` → bộ trả lời `lookup` (mặc định) hoặc lớp `ChatModel` → OpenAI Responses API (chỉ khi chọn `AI_PROVIDER=openai`). Mỗi câu hỏi lấy lại dữ liệu, không dùng dữ liệu tài chính/lịch cũ từ câu trả lời trước. Chỉ tối đa bốn câu hỏi người dùng trước đó được gửi để hiểu câu hỏi tiếp; câu trả lời trước không làm bằng chứng.

- Tận dụng bảng `sessions`, `members`, `attendance`, `weekly_booking_assignments`, các bảng tài chính/du lịch và hàm `private.finance_calculate` đang có. Bảng phí đã chốt dùng `final_summary`, không tính lại theo số đăng ký mới.
- Chọn tên chỉ là đối tượng tra cứu cho “tôi”. Không có tên thì yêu cầu chọn tên; tên không hoạt động thì yêu cầu chọn lại. Không tự thay tên theo tài khoản đang đăng nhập.
- JWT tài khoản và token mã cá nhân được chuyển tới RPC theo cơ chế xác minh hiện tại. Chỉ người đã xác minh mới đọc chi phí, khoản thu và người tham gia du lịch, giống API hiện có; khách đọc lịch, phân công và tóm tắt chuyến công khai. Chọn tên không cấp thêm quyền.
- Service role chỉ gọi `reserve_chat_request` để quản lý hạn mức, **không** dùng để đọc dữ liệu nhóm. Khóa API mô hình, JWT và token cá nhân không đi vào prompt hoặc log.
- RPC chỉ trả trường cần thiết của tối đa 8 buổi/hoạt động, 24 người, 12 khoản chi mỗi hoạt động. Không lấy snapshot toàn database. Các phần bị giới hạn có cờ rõ ràng; mô hình không được suy luận tổng toàn nhóm từ phần dữ liệu thiếu.
- Câu hỏi hỗ trợ tuần/tháng này/sau/trước, hôm nay/mai/qua, thứ trong tuần, ngày `dd/mm/yyyy` hoặc `yyyy-mm-dd`, và buổi/hoạt động đang mở. Ngày theo Việt Nam (UTC+7). Câu hỏi không chỉ rõ ngày mặc định lịch tuần này; tài chính/du lịch trong 90 ngày trước đến 180 ngày tới; câu “tôi còn thiếu” không nêu ngày tra cứu các hoạt động liên quan đã lưu và báo giới hạn nếu có hơn 8 hoạt động. Câu hỏi nhiều ngày cụ thể yêu cầu hỏi từng buổi để tránh ghép nhầm bảng phí.
- Phiên bản đầu chỉ hỏi đáp/hướng dẫn. Không cung cấp công cụ ghi dữ liệu cho mô hình. Đăng ký/sửa lịch/thanh toán đều mở đúng trang chức năng; backend hiện có tiếp tục quyết định quyền.
- Nội dung trả lời hiển thị bằng React text, không render HTML/Markdown từ mô hình. Nút nguồn chỉ dùng đường dẫn nội bộ do backend tạo; ID nguồn ngoài danh sách bị từ chối.

## Tùy chọn: cấu hình OpenAI trả phí

Phần này chỉ dành cho người chủ động muốn dùng API OpenAI. Để dùng miễn phí, làm theo phần `lookup` phía trên và bỏ qua bước tạo key dưới đây.

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

Ban đầu ngày 19/11/2026, Edge Function `club-chat` trả 404 vì chưa deploy. Sau khi người vận hành triển khai, kiểm tra lại đã đạt: **OPTIONS 204** cho website chính và local 5174, câu hỏi cá nhân chưa chọn tên trả **200, needsMember: true**, RPC `get_chat_context` trả **200, version 1**. Kết nối, CORS và migration chatbot đã hoạt động; các phép thử này không gọi mô hình nên chưa xác nhận API key, tín dụng hay quyền dùng model.

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

Đã xác nhận trên trình duyệt local 5174: lỗi thiếu function hiển thị rõ thay vì báo mạng chung. Nút/khung chat ở trái, không tràn ngang tại 320/390/1440px (lề 12px trên điện thoại, 20px desktop). 13 bài kiểm thử client/handler/UI liên quan và TypeScript/build đạt ở lần sửa giao diện/kết nối.

## Khi báo dịch vụ AI đang đạt giới hạn

Bản cũ gộp mọi HTTP 429 từ OpenAI thành “thử lại sau một phút”, kể cả lỗi tín dụng/thanh toán. Thông báo đó **không đủ để kết luận** là gửi quá nhanh hay hết tiền. Theo [mã lỗi OpenAI](https://developers.openai.com/api/docs/guides/error-codes), cần đọc `error.code` cụ thể; `error.type` có thể cùng là `insufficient_quota` cho nhiều lỗi billing. Chờ hoặc gửi lại không khắc phục lỗi tín dụng/hạn mức chi tiêu.

Bản backend mới phân biệt:

| Mã backend                               | Ý nghĩa và xử lý                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model_credits_exhausted`                | Hết tín dụng trả trước. Kiểm tra [OpenAI Billing](https://platform.openai.com/settings/organization/billing/overview) và bổ sung tín dụng nếu muốn tiếp tục.                                                     |
| `model_spend_limit`                      | Chạm hạn mức chi tiêu của key/project/organization. Xem [hướng dẫn spend limits](https://developers.openai.com/api/docs/guides/spend-limits), kiểm tra mức chi hiện tại và chỉ điều chỉnh mức phù hợp ngân sách. |
| `model_usage_limit`                      | Chạm hạn mức sử dụng được cấp. Kiểm tra [Limits](https://platform.openai.com/settings/organization/limits).                                                                                                      |
| `model_billing_inactive` / `model_quota` | Billing chưa kích hoạt, hoặc lỗi quota cũ không nêu nguyên nhân chi tiết. Kiểm tra cả Billing và Limits, đúng organization/project sở hữu key.                                                                   |
| `model_rate_limit`                       | Giới hạn yêu cầu/token tạm thời. Chờ theo `Retry-After` (mặc định 60 giây nếu thiếu); UI đếm thời gian trước khi cho gửi lại.                                                                                    |
| `model_limit_unknown`                    | HTTP 429 chưa nhận diện được loại giới hạn; không khẳng định hết tiền hoặc tự hứa sau một phút sẽ dùng được.                                                                                                     |

Backend chỉ đọc code/type, trả thông báo tiếng Việt cố định; không chuyển nguyên văn lỗi nhà cung cấp có thể chứa thông tin key/tài khoản. Không tự gọi lại mô hình. Lỗi Billing không đặt thời gian chờ giả. Giới hạn chống lạm dụng của website vẫn giữ nguyên và có thông báo riêng (`rate_limit`).

Triển khai lại để nhận phần phân loại lỗi này, không cần thay key hoặc triển khai lại frontend chỉ cho thay đổi này:

```sh
npx supabase functions deploy club-chat --project-ref bzxlfayydfwljjccexub
```

Sau đó thử một câu lịch ngắn và làm theo thông báo cụ thể. Nếu còn lỗi, xem HTTP response `code` của `club-chat` trong Network; không gửi API key vào chat hoặc đưa key xuống Netlify/frontend. Ngày 19/11/2026 người vận hành đã gặp thông báo 429 cũ sau deploy; chưa có mã lỗi gốc để kết luận nguyên nhân thực tế, chưa xác nhận câu trả lời AI thành công.

Kiểm tra bản sửa: 21 bài kiểm thử model/handler/client và TypeScript backend đạt. Đã mô phỏng tín dụng hết, hạn mức chi tiêu/sử dụng, billing chưa kích hoạt, rate limit với `Retry-After`, lỗi không rõ loại, lỗi key/model và phản hồi lỗi không hợp lệ. Đây là kiểm thử phản hồi giả lập, chưa xác nhận tài khoản OpenAI thực tế đã có tín dụng hoặc gọi mô hình thành công.

## Có thể dùng tài khoản ChatGPT đang có không?

Bạn có thể dùng cùng tài khoản/email để đăng nhập OpenAI API Platform và tạo API key. Website gọi API bằng key phía máy chủ; việc đang đăng nhập ChatGPT không tự cấp quyền cho website dùng model, và không nhập mật khẩu/cookie ChatGPT vào chatbot.

Theo [quyền lợi API credits chính thức](https://developers.openai.com/api/docs/guides/chatgpt-api-credits), tại lần kiểm tra 19/11/2026, **Plus, Go và Free không thuộc diện nhận tín dụng API này**. Gói **Pro hoặc Business trả phí đủ điều kiện**, đã hoạt động ít nhất 7 ngày, có thể nhận tín dụng API: dùng cùng email, sở hữu subscription/workspace và API organization được liên kết. Vào **ChatGPT → Settings → Billing → API credits** (hoặc API Platform → Billing), chọn organization và kích hoạt quyền lợi nếu có. Tạo key trong đúng organization đã nhận credit. Hạn mức tùy gói, credit hết hạn theo chu kỳ thanh toán; ngoài quyền lợi này, API tính phí riêng theo lượng dùng. Không cần nâng gói ChatGPT chỉ để bật chatbot; có thể mua tín dụng API trong [Billing](https://platform.openai.com/settings/organization/billing/overview).

## Chi phí và giới hạn

Chế độ `lookup` không có phí mô hình. Nếu bật `AI_PROVIDER=openai`, model mặc định là `gpt-6-luna`, reasoning `none`, Responses API `store:false`, không dùng tìm kiếm web/file hoặc nhiều lượt tool. Theo [giá GPT-6 Luna chính thức](https://developers.openai.com/api/docs/models/gpt-6-luna), giá Standard tại lần kiểm tra 19/11/2026 là **0,10 USD/triệu token đầu vào và 0,50 USD/triệu token đầu ra**: bằng 1/10 giá mỗi token đầu vào/đầu ra của [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) cấu hình trước đây. Ví dụ 3.000 token đầu vào + 400 token đầu ra khoảng **0,0005 USD/lượt**, hay **0,50 USD/1.000 lượt**, chưa gồm Supabase và hạ tầng. Đây là minh họa theo token thực tế, không phải giá cố định. Kiểm tra giá/quyền truy cập model trong tài khoản trước khi bật; chưa kiểm chứng chất lượng model thật khi chưa gắn key.

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

Kiểm tra kết nối mới nhất cùng ngày đã xác nhận migration chatbot và Edge Function hoạt động: RPC version 1, OPTIONS 204 đúng origin production/local, yêu cầu chưa chọn tên trả 200. Cần triển khai phần phân loại lỗi mới và xác nhận secret/billing/model trước khi nghiệm thu phản hồi AI thật, hạn mức production và tài chính bằng danh tính đã xác minh trên Supabase thật. Không coi dữ liệu kiểm thử cục bộ là giao dịch thật hoặc coi trả lời từ mô hình thay thế là phản hồi AI production.
