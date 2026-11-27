# Lịch Sử Phát Hành & Các Bản Cập Nhật (Changelog)

Toàn bộ lịch sử phiên bản, ngày giờ phát hành (múi giờ Việt Nam `GMT+7`) và mã băm commit của dự án **Antigravity Prompt Coach (Self-Host)** được công bố minh bạch dưới đây:

---

## `v1.2.0` — Phát hành: `27/11/2026 (GMT+7)`
- **Tìm kiếm Tiếng Việt FTS5 & Nhảy thẳng tới đúng lượt trong phiên (`AdminPromptCoachSection.tsx`, `AntigravityPcCoachTab.tsx`, `coach_engine.py`)**:
  - Hỗ trợ tìm kiếm toàn văn tiếng Việt (có dấu & không dấu) qua SQLite FTS5 trên toàn bộ tiêu đề phiên và nội dung prompt, kèm tính năng nhảy tức thì tới đúng lượt câu lệnh trong giao diện Song song Thật ↔ 1-Phát.
- **Loại bỏ prompt cha bị fork & khử trùng lặp `step_index` khi sửa/rewind (`coach_collector.py`)**:
  - Tự động lọc bỏ các prompt kế thừa từ phiên cha khi fork hội thoại trong Antigravity Desktop và chỉ giữ bản sửa mới nhất cho mỗi `step_index`, loại bỏ triệt để lỗi đếm trùng/chấm oan prompt.
- **Tối ưu tốc độ thu thập & giảm tải I/O SQLite (`_get_prefix_mem_cache`)**:
  - Giữ bản parse `file_cache` trong RAM theo khóa thư mục giúp Watcher Realtime 2.5s không còn phải đọc lặp hàng chục MB blob SQLite, đồng thời hỗ trợ tùy chọn hồ sơ Antigravity phụ qua biến môi trường `PROMPT_COACH_AG2_HOME`.
- **Chuẩn hóa phiên bản `v1.2.0` trên `package.json`, `prompt_coach_server.py` & biên dịch mới toàn bộ gói `web/` build sẵn**.

---

## `v1.1.0` — Phát hành: `16/11/2026 14:21 (GMT+7)` · Commit `77540f5`
- **Bổ sung Báo cáo Nhịp Realtime 30 Giây (`RealtimeExecutiveReportPanel.tsx` & `realtime_report` API)**:
  - Giúp nắm bắt toàn cảnh hiệu suất Prompt & Phiên trong 30 giây mà không cần đọc từng câu prompt:
    1. **Nhịp sống tức thời (`live_pulse`)**: Danh sách phiên đang chạy trực tiếp (`4 chấm`), nhịp 2 giờ gần nhất và nút **Copy Báo cáo Tóm tắt Markdown 1-Chạm**.
    2. **4 Chỉ số cốt lõi & Thanh nhiệt 7 Chiều Rubric**: Tỷ lệ Ăn ngay 1-Phát (`%`), Tỷ lệ phải sửa/nhắc vòng (`%`), Quỹ lượt & giờ có thể tiết kiệm, và điểm trung bình 7 chiều (`MT`, `NC`, `RG`, `RB`, `ĐR`, `KC`, `AT`).
    3. **Quy luật Pareto 80/20 (`top_bottlenecks`)**: Tự động gom toàn bộ câu yếu/lỗi thành Top 3 điểm nghẽn lớn nhất kèm mẫu câu 1-Phát khắc phục ngay.
    4. **Top 5 Ca Nóng Cần Xem Ngay (`top_actionable_cases`) & Ma trận Sức khỏe Dự án (`by_project`)**: Nhảy thẳng tới đúng phiên và đúng lượt câu lệnh cần xử lý chỉ bằng 1 cú bấm.
    5. **Dòng chảy 15 Lượt Prompt Vừa Gửi (`live_recent_turns`)**: Băng chuyền thời gian thực đối chiếu câu gốc, thời gian AI thực thi (`turn_duration_s`), lỗi Tool và bản viết lại 1-Phát.

---

## `v1.0.1` — Phát hành: `16/11/2026 12:47 (GMT+7)`
- **Minh bạch hóa 100% số liệu & Nhật ký phát hành công khai**:
  - Bổ sung tệp `CHANGELOG.md` và bảng **Lịch sử phát hành & Các bản cập nhật** kèm ngày giờ + mã commit đối chiếu công khai trên cả GitHub lẫn cổng cộng đồng [https://aihot.vn](https://aihot.vn).
  - Chuẩn hóa toàn bộ bộ đếm cộng đồng (sao, lượt cài, lượt thích) bắt đầu từ `0` thực tế (chỉ tăng khi có thành viên thực sự tương tác).

---

## `v1.0.0` — Phát hành: `16/11/2026 12:26 (GMT+7)` · Commit `0dfd9e6`
- **Bản phát hành độc lập Self-Host đầu tiên (`100% Zero-Data-Leak` · Python 3.9+ chuẩn)**:
  - **Kiến trúc 0 phụ thuộc ngoài**: Máy chủ cục bộ `prompt_coach_server.py` + bộ chấm `coach_engine.py` + trình thu thập `coach_collector.py` + giao diện `web/` đã build sẵn (thành viên chỉ cần Python 3.9+, không cần cài Node.js hay `pip install`).
  - **Đồng bộ Thứ tự Realtime 2.5 giây khớp 1:1 với Antigravity PC**: Đọc trực tiếp `conversation_summaries.db` + `annotations/*.pbtxt` + `config/projects/*.json`, tự động xếp `Đã ghim` → `Phiên đang chạy (biểu tượng 4 chấm nhấp nháy)` → `Mới hoạt động gần nhất` (`Vừa xong`, `2 phút`, `5 phút`…).
  - **Khung chấm 6 Giai đoạn × 7 Chiều (Stage-Aware Rubric) + HRPO Linker (Offline `0đ`)**:
    - Nhận diện 6 giai đoạn (`Khám phá`, `Chẩn đoán lỗi`, `Thực thi làm/sửa`, `Kiểm chứng & Test`, `Quy trình tái sử dụng`, `Chốt hành động`) và chấm 7 chiều (`MT`, `NC`, `RG`, `RB`, `ĐR`, `KC`, `AT`).
    - Bóc tách phản hồi thật của AI (`turn_duration_s`, `assistant_summary`, `files_touched`, `failed_tools`).
  - **Giao diện Antigravity PC Song song (Thật ↔ 1-Phát) Full Màn Hình (`100vw × 100dvh`)** + **Bảng Chấm điểm Prompt** + **Composer Giả lập Dry-Run A/B**.
  - **Bảo mật 2 lớp & Kiểm thử tự động**: Bộ lọc Redaction che sạch API Key/Token/Mật khẩu/Chuỗi kết nối DB trước khi lưu vào `~/.antigravity_prompt_coach/prompt_coach.db`, khóa PIN 6 số chống Brute-Force khi bật `--lan`, và bộ kiểm thử tự động `test_prompt_coach.py` (`5/5 PASS`).

---

## Các mốc nâng cấp hạt nhân A12 trước khi tách Repo độc lập

### `v0.9.5 (A12 Core)` — Cập nhật: `16/11/2026 11:30 (GMT+7)` · Commit `3e6346a`
- Đồng bộ thứ tự phiên Realtime 1:1 với cửa sổ Antigravity PC Desktop (`is_running`, `is_pinned`, `last_activity_ts`).
- Giữ trọn vẹn các phiên ngắn 1–2 prompt đạt chuẩn xanh (không bị cắt bởi giới hạn 150 phiên) và khóa phiên đang đọc chống nhảy màn hình khi danh sách cập nhật ngầm.

### `v0.9.0 (A12 Core)` — Cập nhật: `16/11/2026 10:59 (GMT+7)` · Commit `a401957`
- Hoàn tất gói tối ưu **P0 + P1** sau phản biện Swarm:
  - Sửa chấm oan ở các phiên dài (`>12 prompt`), bổ sung bộ nhớ kế thừa ngữ cảnh file trong cùng phiên.
  - Nâng cấp collector `v4` bóc tách thời lượng lượt chạy, tóm tắt phản hồi Assistant, danh sách file chạm tới và tên công cụ bị lỗi.
  - Tăng tốc độ truy vấn bằng bộ nhớ đệm LRU và gom đợt hiển thị 25 lượt/lần (`content-visibility: auto`).

### `v0.8.0 (A12 Core)` — Cập nhật: `16/11/2026 09:20 (GMT+7)` · Commit `89a7b69` & `62da0f5`
- Ra mắt giao diện **Antigravity PC Song song (Thật ↔ 1-Phát)** chế độ Full Màn Hình (`100vw × 100dvh`) và **Bảng Chấm điểm & Tối ưu từng Prompt**.
