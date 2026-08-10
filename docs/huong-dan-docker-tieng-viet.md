# Hướng dẫn cài đặt & sử dụng (Docker Chromium)

> Bản tiếng Việt, chi tiết từng bước. Bản tiếng Anh ngắn gọn hơn:
> [docker-chromium-setup.md](docker-chromium-setup.md).

## 1. Hiểu mô hình trước khi cài (quan trọng!)

```text
┌─────────────── Máy của bạn ───────────────┐   ┌──────── Container Docker ────────┐
│                                           │   │                                  │
│  Codex app  ◀── bạn GIAO VIỆC Ở ĐÂY ──┐   │   │  Bridge (dịch Codex ⇄ ChatGPT)   │
│      │                                │   │   │      │                           │
│      └── http://127.0.0.1:17841/v1 ───┼───┼──▶│      ▼                           │
│                                       │   │   │  Chromium mở ChatGPT web         │
│  Trình duyệt của bạn ── chỉ để ĐĂNG NHẬP ─┼──▶│  (nhìn thấy qua noVNC :7900)     │
│  http://localhost:7900                    │   │                                  │
└───────────────────────────────────────────┘   └──────────────────────────────────┘
```

- **Giao việc ở đâu?** → Trong **app Codex**, như mọi khi. Setup tự trỏ Codex vào bridge
  qua `openai_base_url` trong `~/.codex/config.toml`. Bạn chỉ cần chọn model
  **ChatGPT Web — …** trong model picker của Codex.
- **Trang web `localhost:7900` để làm gì?** → Chỉ 2 việc: **đăng nhập ChatGPT**
  (lần đầu, hoặc khi phiên hết hạn ~3 tháng) và **xem** Chromium chạy nếu tò mò.
  Đăng nhập xong là đóng tab được, không bao giờ cần gõ gì vào ChatGPT web.
- **Màn hình đen trên noVNC là bình thường** — đó là desktop ảo trống. Cửa sổ Chromium
  chỉ hiện khi đang đăng nhập hoặc khi Codex đang chạy một turn.

## 2. Yêu cầu

- Docker Desktop đang chạy (Windows/macOS) hoặc Docker Engine + Compose v2 (Linux).
- Codex đã cài trên máy (config nằm ở `~/.codex`).
- Tài khoản ChatGPT đăng nhập được bằng **email + mật khẩu** hoặc **mã gửi qua email**.
  - ❌ **Passkey/Windows Hello**: không hoạt động trong container.
  - ⚠️ **"Continue with Google"**: thường bị Google chặn ("browser không an toàn") — tránh dùng.

## 3. Cài đặt từ đầu

Mở terminal tại thư mục repo này rồi chạy:

```bash
docker compose up -d --build
```

Lần đầu build mất vài phút. Sau đó theo dõi log:

```bash
docker compose logs -f codex-chatgpt-web
```

Chờ đến khi thấy banner:

```text
============================================================================
 First boot: ChatGPT sign-in required.
 ...
============================================================================
```

> Nếu log báo lỗi về `openai_base_url` đã tồn tại: bạn từng cài route khác vào Codex.
> Chạy lại với biến cho phép thay thế:
> PowerShell: `$env:REPLACE_CODEX_ROUTE = "1"; docker compose up -d`
> Bash: `REPLACE_CODEX_ROUTE=1 docker compose up -d`

## 4. Đăng nhập ChatGPT (từng bước)

1. Mở trình duyệt trên máy bạn, vào:
   **<http://localhost:7900/vnc.html?autoconnect=1&resize=scale>**
2. Bạn sẽ thấy một cửa sổ Chromium đang mở trang ChatGPT. **Click vào giữa trang một lần**
   để chuột/bàn phím điều khiển được màn hình bên trong.
3. Bấm **Log in** → nhập **email** → chọn tiếp **mật khẩu** hoặc **mã qua email**:
   - Mã qua email: mở hộp thư trên máy bạn, đọc mã 6 số, gõ vào cửa sổ noVNC.
   - Mật khẩu có ký tự đặc biệt: bàn phím VNC là layout US — nếu gõ sai, mở sidebar
     noVNC (mũi tên nhỏ mép trái) → biểu tượng **clipboard** → dán mật khẩu vào ô đó →
     click vào ô password trong màn hình → nhấn `Ctrl+V`.
4. Nếu Cloudflare hiện ô **"Verify you are human"** → tick vào ô ngay trong cửa sổ.
5. Đăng nhập xong, **không cần làm gì thêm** — kể cả khi ChatGPT đưa bạn về trang chủ,
   hệ thống tự chuyển về Temporary Chat, tự lưu phiên, tự xác minh, tự cài route và
   khởi động bridge. **Đừng đóng cửa sổ Chromium**; nó tự đóng khi xong.
6. Toàn bộ quá trình có hạn ~10 phút. Nếu quá hạn, container tự khởi động lại và mở
   cửa sổ đăng nhập mới — làm lại từ bước 1.

Xác nhận thành công — log sẽ in:

```text
Setup complete: browser-only
[docker] setup complete; Codex config updated at /data/codex/config.toml
codex-chatgpt-web x.y.z listening on http://127.0.0.1:17841/v1 (browser-only)
```

## 5. Bật Codex và dùng

1. **Tắt hẳn app Codex rồi mở lại** (bắt buộc một lần, để nạp catalog qua route mới).
2. Mở model picker → chọn **ChatGPT Web — Luna** (tài khoản Free/Go) hoặc
   **Instant/Medium/High/Extra High/Pro** (tài khoản Plus/Pro).
3. Giao việc trong Codex như bình thường. Muốn xem ChatGPT chạy: mở lại trang noVNC.

Kiểm tra sức khỏe bất cứ lúc nào:

```bash
docker compose exec codex-chatgpt-web codex-chatgpt-web doctor
```

## 6. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Màn hình noVNC đen | Bình thường — không có cửa sổ nào đang mở | Không cần làm gì; cửa sổ hiện khi đăng nhập/chạy turn |
| Google báo "browser không an toàn" | Google chặn browser trong container | Dùng email + mật khẩu hoặc mã qua email |
| Captcha Cloudflare hiện lại nhiều lần | Fingerprint tự động hóa | Tick captcha; nếu lặp >3 lần, khởi động lại container và thử lại |
| Codex không thấy model ChatGPT Web | Chưa restart Codex sau setup | Tắt hẳn Codex, mở lại |
| Turn báo lỗi login state missing/expired | Phiên ChatGPT hết hạn (~3 tháng) | `docker compose exec codex-chatgpt-web codex-chatgpt-web login` → đăng nhập qua noVNC → `docker compose restart codex-chatgpt-web` |
| Muốn đổi tài khoản ChatGPT | — | Như trên: chạy `login`, đăng nhập tài khoản mới, restart |
| Muốn làm lại từ đầu | — | Xem mục 7 |

## 7. Reset toàn bộ / Gỡ cài đặt

```bash
docker compose exec codex-chatgpt-web codex-chatgpt-web route disconnect
```

```bash
docker compose down -v
```

- `route disconnect` trả `~/.codex/config.toml` về nguyên trạng (Codex quay lại model thường).
- `down -v` xóa container + volume (mất phiên đăng nhập đã lưu).
- Cài lại: quay về mục 3.

## 8. Tài khoản Free và cơ chế tự cắt gọn ngữ cảnh (Luna)

ChatGPT Free từ chối tin nhắn đơn lẻ vượt ~**28.000 token** (giới hạn transport, không phải
cửa sổ 1M của model). Vì mỗi turn Codex phải nhét toàn bộ ngữ cảnh vào một tin nhắn, task
lớn có thể vượt trần này.

Fork này xử lý **tự động** khi model là Luna:

1. **Mọi turn Luna** đều được bỏ các khối quy tắc chỉ dành cho harness cục bộ (các section
   `## Rule:` kiểu ClaudeKit như bảng routing skill `/ck:`, hook protocol, luật Agent
   Team — model Web không dùng được chúng).
2. Nếu sau đó vẫn vượt 28k → tóm tắt các section quy tắc còn lại về đoạn mở đầu.
3. Việc cắt chỉ áp dụng lên **bản sao gửi vào browser** — file trên máy (AGENTS.md...)
   không bao giờ bị sửa, và Codex dùng model thường không bị ảnh hưởng.
4. Dòng ✂️ hiện trong trace của Codex khi việc cắt đã "cứu" một turn quá khổ; các lần cắt
   thông thường ghi trong log container (`docker compose logs`). Nếu cắt hết mức mà vẫn
   vượt, log ghi rõ khối nào còn nặng bao nhiêu.

Tùy biến danh sách section bị cắt qua biến môi trường
`CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` (danh sách tên cách nhau dấu phẩy; đặt `off` để tắt).

## 9. Ghi nhớ

- **Không đổi cổng host `17841`** — Codex được trỏ cứng vào `http://127.0.0.1:17841/v1`.
- Cả 2 cổng (17841, 7900) chỉ bind vào `127.0.0.1` của máy bạn, không lộ ra mạng LAN.
- Volume `codex-chatgpt-web-home` chứa phiên đăng nhập ChatGPT — nhạy cảm, đừng chia sẻ.
