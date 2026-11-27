# Antigravity Prompt Coach v1.2 — Chấm Điểm 6×7 Rubric, Tìm Kiếm FTS5 Tiếng Việt, Báo Cáo 30s & Đồng Bộ Realtime PC (Self-Host · 100% Zero-Data-Leak)

> **Bộ công cụ tự host (Self-Host) trên máy tính cá nhân giúp bạn tự động chấm điểm, tìm kiếm siêu tốc FTS5 tiếng Việt có/không dấu, bắt bệnh và tối ưu toàn bộ lịch sử Prompt của cả 3 công cụ AI: Antigravity Desktop, Claude Code và Codex Desktop (ChatGPT PC) — 0 cần cài Node.js hay thư viện ngoài (chỉ cần Python 3.9+ chuẩn), đồng bộ thứ tự Realtime 2.5 giây khớp 1:1 với cửa sổ Antigravity PC và giữ 100% dữ liệu trên ổ cứng máy bạn.**

---

## Điểm nổi bật (Cập nhật v1.2.0 — 27/11/2026 · xem [CHANGELOG.md](CHANGELOG.md))

- **✨ Mới trên v1.2.0**:
  - **Tìm kiếm Tiếng Việt FTS5 & Nhảy thẳng tới đúng lượt trong phiên**: Tìm cực nhanh theo từ khóa tiếng Việt có dấu / không dấu trên toàn bộ lịch sử prompt & phiên hội thoại, bấm 1 chạm nhảy thẳng tới đúng lượt câu lệnh cần đối chiếu.
  - **Loại bỏ prompt cha bị fork & khử trùng lặp `step_index` bị sửa**: Khi bạn nhân bản (fork) phiên hội thoại hoặc sửa/rewind prompt trong Antigravity Desktop, bộ thu thập tự động loại trừ các prompt lịch sử kế thừa từ phiên cha và chỉ giữ bản sửa cuối của từng `step_index`, chấm điểm chính xác 100%.
  - **Tối ưu tốc độ quét & chuẩn hóa Telemetry**: Bộ nhớ đệm `file_cache` trong RAM loại bỏ việc đọc lặp các blob SQLite lớn, giảm I/O ổ cứng xuống tối thiểu khi watcher chạy 2.5s liên tục.
  - **Đồng bộ Báo cáo Nhịp Realtime 30 Giây & Pareto 80/20** (từ v1.1.0) cùng bộ web build sẵn (`web/`) mới nhất.

1. **Giao diện Antigravity PC Song song (Thật ↔ 1-Phát) Full Màn Hình (`100vw × 100dvh`)**:
   - **Cột trái**: Mô phỏng nguyên bản cửa sổ hội thoại thật của bạn trên Antigravity PC (kèm thời lượng chạy từng lượt `turn_duration_s`, tóm tắt phản hồi của AI `assistant_summary`, các file đã sửa/đọc `files_touched`, và chỉ báo đỏ chính xác công cụ bị lỗi `failed_tools`).
   - **Cột phải**: Bản viết lại chuẩn **1-Phát (1-Shot Spec)** cho từng bước và bản gộp chiến lược cho các phiên dài (`>12 prompt`), tự động rút gọn các lượt đã đạt chuẩn (`>=80đ`) thành 1 dòng gọn gàng để tập trung đúng chỗ cần cải thiện.
   - **Đồng bộ Thứ tự Realtime 1:1 với Antigravity PC (`2.5 giây`)**: Đọc trực tiếp `conversation_summaries.db` + `annotations` + `config/projects`, tự động đưa **Đã ghim** → **Phiên đang chạy (biểu tượng 4 chấm nhấp nháy)** → **Mới hoạt động gần nhất (`Vừa xong`, `2 phút`, `5 phút`…)** lên đầu mà không làm giật cuộc hội thoại đang đọc.

2. **Khung chấm điểm 6 Giai đoạn × 7 Chiều (Stage-Aware Rubric) + HRPO Linker (Chạy Offline `0đ`)**:
   - Phân loại tự động 6 giai đoạn thực tế: `Khám phá`, `Chẩn đoán lỗi`, `Thực thi làm/sửa`, `Kiểm chứng & Test`, `Quy trình tái sử dụng`, và `Chốt hành động` (không chấm oan các câu xác nhận ngắn hợp lệ ở giữa phiên dài).
   - Chấm 7 chiều trực quan: **MT** (Mục tiêu), **NC** (File/Ngữ cảnh — có bộ nhớ kế thừa ngữ cảnh trong cùng phiên), **RG** (Ranh giới), **RB** (Ràng buộc), **ĐR** (Định dạng), **KC** (Tiêu chí Done), **AT** (Rào an toàn DB/Deploy).
   - **Bảng Chấm điểm Prompt chuyên sâu**: Lọc nhanh các câu dính lỗi Tool, thiếu tiêu chí Done, thiếu rào an toàn hoặc điểm thấp trên toàn bộ lịch sử làm việc.

3. **Khung Composer Trực tiếp & Giả lập Dry-Run A/B**:
   - Gõ nháp Prompt ở đáy màn hình để xem chấm điểm 7 chiều tức thì theo từng phím gõ, bấm **Nâng lên 1-Phát** và chạy **Dry-Run A/B** để so sánh kế hoạch AI dự kiến trước khi copy sang Antigravity / Claude / Codex.

4. **100% Bảo mật Cục bộ (Zero-Data-Leak) & Tự động che Bí mật 2 Lớp**:
   - Mặc định chỉ lắng nghe tại `127.0.0.1:8788` trên máy bạn; toàn bộ SQLite nằm tại `~/.antigravity_prompt_coach/prompt_coach.db`.
   - Bộ lọc Redaction 2 lớp tự động che sạch API Key (`sk-...`, `AIza...`, `ghp_...`, `AKIA...`), Bearer/JWT, chuỗi kết nối DB (`postgres://user:pass@...`), JSON secret và `.env` ngay khi quét.
   - Hỗ trợ tùy chọn kết nối AI nâng cao qua **Antigravity Tools Proxy cục bộ (`127.0.0.1:8045`)**, `GEMINI_API_KEY`, `OPENAI_API_KEY`, hoặc bất kỳ endpoint Ollama / OpenAI-compatible nào (`PROMPT_COACH_LLM_URL`). Nếu không cấu hình khóa AI, toàn bộ tính năng chấm điểm & gợi ý 1-Phát vẫn chạy mượt **Offline 0đ**.

---

## Cách 1: Cài đặt & Chạy 1-Chạm bằng PowerShell (Khuyên dùng trên Windows)

Mở **PowerShell** và dán 1 dòng lệnh duy nhất (không cần cài Node.js hay `pip install`):

```powershell
irm https://raw.githubusercontent.com/vudanhdu2/antigravity-prompt-coach/main/install-and-run.ps1 | iex
```

Trình duyệt sẽ tự động mở tại `http://127.0.0.1:8788`.

---

## Cách 2: Clone từ GitHub (Windows / macOS / Linux)

```bash
git clone https://github.com/vudanhdu2/antigravity-prompt-coach.git
cd antigravity-prompt-coach

# Chạy ngay (chỉ cần Python 3.9+ chuẩn):
python prompt_coach_server.py --port 8788

# Hoặc chạy ngầm tách tiến trình:
python prompt_coach_server.py --detach --port 8788

# Mở xem thêm từ Điện thoại / Tablet cùng mạng Wi-Fi (tự bật khóa PIN 6 số + chống Brute-Force):
python prompt_coach_server.py --lan --port 8788
```

Trên Windows, bạn cũng có thể bấm đúp trực tiếp vào tệp `start-prompt-coach.bat`.

---

## Kết nối AI Chấm sâu & Giả lập A/B (Tùy chọn)

- **Tự động (0 cấu hình)** nếu máy bạn đang bật **Antigravity Tools** (`http://127.0.0.1:8045`).
- Hoặc đặt biến môi trường cho Gemini / OpenAI / Ollama trước khi chạy:

```powershell
# Dùng Gemini API:
$env:GEMINI_API_KEY = "AIza..."
python prompt_coach_server.py

# Hoặc dùng Ollama / LM Studio nội bộ:
$env:PROMPT_COACH_LLM_URL = "http://127.0.0.1:11434/v1/chat/completions"
$env:PROMPT_COACH_LLM_MODEL = "qwen2.5-coder:14b"
python prompt_coach_server.py
```

---

## Chạy Bộ Kiểm Thử Tự Động (Security + Rubric + Realtime Order + HTTP Server)

```bash
python test_prompt_coach.py
```

---

## Phát triển & Tùy biến Giao diện (Dành cho Developer muốn sửa UI React)

 Kho mã đã đóng gói sẵn thư mục `web/` nên người dùng bình thường **không cần Node.js**. Nếu bạn muốn sửa giao diện trong `src/`:

```bash
npm install
npm run build
python prompt_coach_server.py
```

---

Phát triển và chia sẻ bởi cộng đồng **[AIHOT.VN](https://aihot.vn)** · Giấy phép **MIT License**.
