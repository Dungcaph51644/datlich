# Giao diện thể thao — 10/11/2026

Mục tiêu: giao diện có cá tính thể thao và nhiều chuyển động, giữ đường đăng ký nhanh trên điện thoại.

## Hệ thống giao diện

- Xanh rừng `#092c25`, lime `#d3f66b`, nền trắng ngà `#f5f6f1`.
- Be Vietnam Pro tự lưu trữ; giấy phép tại [OFL.txt](../public/fonts/OFL.txt).
- [SportUI.tsx](../src/SportUI.tsx) chứa banner và logic chuyển động; [sport.css](../src/sport.css) áp dụng phong cách chung cho lịch, thẻ, thành viên, thông báo và hộp thoại.
- Dùng CSS và IntersectionObserver; không thêm thư viện animation. Chuyển động nền tạm dừng khi không nhìn thấy hoặc ẩn tab. Có nút giảm hiệu ứng, hỗ trợ `prefers-reduced-motion`.
- Không remount ô ghi chú khi dữ liệu Realtime thay đổi; chỉ số người có hiệu ứng sau khi nhận dữ liệu thật. Không thay đổi RPC, phân quyền hoặc cơ chế xác nhận lưu.

## Ảnh banner

Chế độ: **generate**, ảnh mới bằng imagegen, không ảnh tham chiếu, nền không trong suốt.

Ảnh dùng trong website: [badminton-hero.jpg](../public/images/badminton-hero.jpg), 1536 × 1024, JPEG quality 82, khoảng 238 KB. Tệp ảnh gốc do công cụ sinh ra được giữ nguyên; JPEG chỉ là bản tối ưu để đưa lên web.

Prompt đã dùng:

> Create a premium photorealistic 3D sports campaign hero image for a Vietnamese badminton club website. Landscape composition 3:2 aspect ratio. A dramatic close-up of one immaculate white feather badminton shuttlecock floating midair in the upper-right quadrant, feather detail crisp and sculptural, and one graphite-black badminton racket with thin neon chartreuse/lime accents sweeping diagonally up from the lower-right corner. Cropped lime court boundary lines recede into a deep dark forest green indoor court, glossy surface but subtle, cinematic directional studio lighting, soft lime rim light, sophisticated sporting equipment product photography, powerful elegant movement, fine motion streaks behind the equipment, realistic materials, deep shadow. Palette extremely dark evergreen #092c25, chartreuse #d0f45b, crisp white. Left 50 percent and bottom left must be predominantly empty deep forest green negative space with almost no detail for HTML headline overlay. Equipment is large, right aligned, occupies right 50 percent; generous negative space. No people, no words, no letters, no logos, no watermarks, no text. High-end editorial art direction, energetic yet refined, sharp and beautiful. This is a web background asset, no UI mockup.

## Kiểm tra trong lượt làm mới

- Build production và 23 kiểm thử hiện có đạt.
- Trang lịch: không tràn ngang ở 320, 375, 390, 768, 1024, 1440px; nút đăng ký cao 47px trên điện thoại; ô ghi chú 16px.
- Danh sách thành viên, hộp chọn tên và chi tiết buổi: không tràn ngang ở 320, 390, 768, 1440px.
- Tìm tên đúng một kết quả, chọn tên hiển thị đăng ký thật, tải lại vẫn nhớ tên. Không gửi thay đổi đăng ký lên database trong lượt kiểm tra giao diện.
- Chuyển tuần và quay lại vẫn hiện nội dung khi cuộn. Nút giảm hiệu ứng tắt animation và nhớ qua tải lại. Cài đặt giảm chuyển động của hệ điều hành tắt animation, không ẩn nội dung.
- Không có lỗi JavaScript trong lượt kiểm tra tải lại. Kiểm tra trình duyệt với dữ liệu Supabase thật không thay thế nghiệm thu hai người cùng ghi dữ liệu trực tuyến.
