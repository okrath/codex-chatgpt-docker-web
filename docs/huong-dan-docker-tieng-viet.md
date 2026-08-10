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

## 1b. Tài khoản ChatGPT Free: làm được gì và giới hạn duy nhất

**Full mode CHẠY ĐƯỢC trên tài khoản Free.** Đã kiểm chứng đầy đủ: một tài khoản Free bật
Developer mode, tạo connector Tunnel **Codex Native2**, và Luna gọi thành công tool cục bộ
của Codex (đọc file trong workspace) qua connector đó — **không cần gói trả phí**. Cả
browser-only lẫn full mode (local tools) đều chạy trên Luna miễn phí.

**Bất cập DUY NHẤT là giới hạn dung lượng mỗi lượt, không phải khóa tính năng.** ChatGPT
Free giới hạn **~28.000 token cho MỖI tin nhắn browser**, và mỗi turn Codex phải gói vào
đúng một tin nhắn. Đây là giới hạn transport của web Free — **không phải** cửa sổ ngữ cảnh
của model Luna (~1 triệu token) và **không thể nới** từ phía dự án này. Thực tế:

- Task nhỏ, gọn thì chạy tốt: prompt ngắn, vài file, lịch sử ngắn.
- Thread dài, nhiều tool vẫn chạy được: bridge tự cắt kết quả tool cũ và lịch sử để vừa
  ngân sách (xem mục **cơ chế tự cắt** bên dưới), nên thread sâu không còn bị kẹt ở
  *"ran out of room in the model's context window."* Đánh đổi: model Web không còn thấy
  toàn văn output tool cũ — nó giữ các turn gần nhất + checkpoint của Luna, nên câu hỏi về
  chi tiết từ nhiều lượt trước sẽ kém chính xác.
- Một turn vẫn có thể tràn khi phần **lõi không cắt được** đã quá lớn — system prompt của
  Codex, contract tool MCP (full mode), instruction hiện tại, và một file lớn vừa đọc đều
  phải vừa ~28k kể cả sau khi cắt. Full mode có thêm contract tool nên mỗi turn **nặng
  hơn**, dư địa cho nội dung của bạn ít hơn browser-only.
- Nếu cắt hết mức mà turn vẫn tràn: giảm turn (tỉa `~/.codex/AGENTS.md`, mở thread
  mới/ngắn, làm ít file / file nhỏ hơn một lúc) hoặc dùng gói ChatGPT trả phí — transport
  lớn hơn nhiều và mở khóa Instant/Medium/High/Extra High.
- Bridge **không thể tự mở thread Codex mới** cho bạn (thread do Codex quản lý; bridge chỉ
  trả lời từng turn) — nhưng nhờ tự cắt, bạn hiếm khi cần. Khi chính Codex khuyên tạo
  thread mới, đó vẫn là cách reset sạch nhất cho thread đã tích lịch sử cực lớn.

Xem `docker compose logs codex-chatgpt-web` để biết con số token chính xác mỗi khi turn bị
từ chối.

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

Fork này xử lý **tự động** khi model là Luna, cắt theo thứ tự leo thang cho tới khi vừa 28k:

1. **Mọi turn Luna** đều bỏ các khối quy tắc chỉ dành cho harness cục bộ (các section
   `## Rule:` kiểu ClaudeKit như bảng routing skill `/ck:`, hook protocol, luật Agent
   Team — model Web không dùng được chúng).
2. Nếu vẫn vượt → **tóm tắt** các section quy tắc còn lại về đoạn mở đầu.
3. Nếu vẫn vượt → **gộp lịch sử cũ**: xóa hẳn và thay cả đoạn cũ bằng **một** message đánh
   dấu duy nhất, thu hẹp dần cho tới khi vừa — gần như chỉ còn turn hiện tại nếu cần (luôn
   giữ các message gần nhất + round đang chạy dở; developer contract cũ chỉ bị gộp ở bước
   sâu nhất). Gộp thành 1 marker rất quan trọng: thread rất dài có hàng trăm mục, nếu để
   một ghi chú cho mỗi mục thì riêng đống ghi chú đã tốn hàng chục nghìn token. Một thread
   ~340k token nén được xuống ~10k theo cách này.

Nhờ tầng 3–4, thread dài nhiều tool **không còn chết** ở lỗi "ran out of room" — usage báo
về Codex là con số sau khi cắt nên Codex cũng không tự loại bỏ thread. Đánh đổi: model
không còn thấy toàn văn tool/lịch sử cũ (giữ turn gần + checkpoint Luna).

Việc cắt chỉ áp dụng lên **bản sao gửi vào browser** — file trên máy (AGENTS.md...) không
bao giờ bị sửa, và Codex dùng model thường không bị ảnh hưởng. Dòng ✂️ hiện trong trace của
Codex khi việc cắt đã "cứu" một turn quá khổ; các lần cắt thông thường ghi trong log
container (`docker compose logs`). Nếu cắt hết mức mà vẫn vượt, log ghi rõ khối nào còn
nặng bao nhiêu.

Tùy biến danh sách section bị cắt qua biến môi trường
`CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` (danh sách tên cách nhau dấu phẩy; đặt `off` để tắt).

## 9. Full mode — cho model quyền dùng tool cục bộ (MCP)

Browser-only chỉ cho model đọc ngữ cảnh; **full mode** cho phép model gọi ngược về tool
của task Codex (đọc/ghi file, chạy lệnh) qua tunnel chính thức của OpenAI (outbound —
không mở cổng vào). Mọi model Web trừ Pro đều có tool, **kể cả Luna**. Yêu cầu: ChatGPT
bật được **Developer Mode** + tạo custom connector — đọc lưu ý về hạng tài khoản ở cuối
mục trước khi làm.

**Bước 1 — Tạo Tunnel.** Mở trang Tunnels trên OpenAI platform, tạo một cái rồi copy id
(dạng `tunnel_...`):

  https://platform.openai.com/settings/organization/tunnels

**Bước 2 — Tạo API key** có quyền Tunnels Read + Use:

  https://platform.openai.com/settings/organization/api-keys

Cả 2 đều tạo miễn phí, không tốn credit model.

**Bước 3 — Nhập runtime key vào container** (dán key vào ô nhập ẩn):

```bash
docker compose exec -it codex-chatgpt-web codex-chatgpt-web tunnel key-import
```

**Bước 4 — Chuyển sang full mode** (dùng lại login ChatGPT đã lưu; thay id bằng id của bạn
ở Bước 1):

```bash
docker compose exec codex-chatgpt-web codex-chatgpt-web setup --full --tunnel-id tunnel_YOUR_ID --acknowledge-unofficial
```

**Bước 5 — Khởi động lại để container bắt đầu giám sát tunnel runtime:**

```bash
docker compose restart codex-chatgpt-web
```

**Bước 6 — Tạo connector trong ChatGPT.** Làm hoàn toàn trong giao diện web ChatGPT (mở
trên màn hình noVNC hoặc trình duyệt của bạn):

  https://chatgpt.com/#settings/Plugins

  1. Bật **Developer mode** trước: **Settings → Security and login → Developer mode**
     (gạt toggle sang bật; sẽ có nhãn "Elevated risk").
  2. Vào **Settings → Plugins**. Nút **Create connector** nằm ở **góc trên panel Plugins**
     (không phải chui vào dòng "Developer mode") — nhấn nút đó.
  3. Điền form:
     - **Type / MCP server:** Tunnel — chọn đúng tunnel đã tạo ở Bước 1
     - **Authentication:** None
     - **Name:** chính xác `Codex Native2` (từng ký tự)
  4. Lưu. Mở connector vừa tạo, đặt **Permissions → Allow all actions**
     (chọn "Allow low-risk actions" sẽ chặn lệnh và patch).
  5. Quay lại panel Plugins, dòng đó phải hiện **`Codex Native2 — Connected · Allow all`**,
     và gõ `@` trong chat sẽ thấy **Codex Native2**.

  Đừng đổi tên hay dùng lại connector **Codex Native** cũ.

**Bước 7 — Restart app Codex một lần**, tạo task mới. Kiểm tra sức khỏe: `doctor` và
`tunnel status` trong container. Tunnel cần ~15–30 giây sau khi restart container mới
sẵn sàng — nếu `doctor` báo "Tunnel runtime is not ready" ngay sau restart, chờ chút rồi
chạy lại. Full mode khỏe mạnh khi doctor hiện `✓ Tunnel runtime reports healthy and ready`;
dòng cảnh báo connector còn lại chỉ là thông tin (kiểm tra cục bộ không nhìn thấy settings
ChatGPT).

> **Tài khoản Free dùng được.** Developer mode và custom Tunnel connector có sẵn trên gói
> ChatGPT miễn phí (đã kiểm chứng: một tài khoản Free tạo và kết nối `Codex Native2` với
> Allow all actions). Nếu connector chưa hiện trong menu `@` ngay sau khi tạo, mở lại chat
> — nó đồng bộ trong vài giây. Lỗi `connector menu opened but exposed no row named
> "Codex Native2"` chỉ nghĩa là connector chưa được tạo (hoặc tên chưa đúng chính xác
> `Codex Native2`).

Quay về browser-only: `setup --browser-only --acknowledge-unofficial` rồi restart container.
Lưu ý: trong container, `tunnel start/stop/restart` bị chặn có chủ đích — container tự
giám sát tunnel; muốn khởi động lại thì restart container.

## 10. Ghi nhớ

- **Không đổi cổng host `17841`** — Codex được trỏ cứng vào `http://127.0.0.1:17841/v1`.
- Cả 2 cổng (17841, 7900) chỉ bind vào `127.0.0.1` của máy bạn, không lộ ra mạng LAN.
- Volume `codex-chatgpt-web-home` chứa phiên đăng nhập ChatGPT — nhạy cảm, đừng chia sẻ.
