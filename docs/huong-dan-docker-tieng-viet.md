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

### Giới hạn token mỗi turn theo gói tài khoản

Các giới hạn này **đã có sẵn trong code** — upstream đo thực nghiệm biên transport thật của
từng gói, và bridge tự chọn đúng giới hạn theo capability phát hiện lúc đăng nhập. Không
cần cấu hình gì:

| Gói tài khoản | Model trong Codex | Ngân sách thực tế mỗi turn | So với Free |
| --- | --- | --- | --- |
| **Free / Go** | Luna | **~28.000 token**/tin nhắn (transport từ chối cứng) | 1× |
| **Plus** | Instant | ~32k trước khi Codex tự compact (cửa sổ 41k) | ~1,1× |
| **Plus** | Medium / High | **~80k** trước khi tự compact (cửa sổ 90k) | **~2,9×** |
| **Pro** | Instant–Extra High | **~103.000 token**/tin nhắn | ~3,7× |
| **Pro** | Pro (max) | ~104.000 token/tin nhắn | ~3,7× |

Lưu ý:

- Với Plus/Pro, tài khoản có bộ chọn model nên **Luna biến mất** khỏi picker và toàn bộ cơ
  chế cắt/gộp dành riêng cho Luna không còn áp dụng — các model Sol dùng compaction chuẩn
  của Codex ở các ngưỡng trên.
- Nâng gói xong, làm mới login + capability rồi restart:

  ```bash
  docker compose exec -it codex-chatgpt-web codex-chatgpt-web setup --full --login --acknowledge-unofficial
  ```

  ```bash
  docker compose restart codex-chatgpt-web
  ```

  Đăng nhập tài khoản mới qua noVNC; tunnel và connector **Codex Native2** giữ nguyên,
  không phải làm lại. Sau đó restart app Codex một lần.
- Đây là các biên đo thực nghiệm trên UI ChatGPT (upstream theo dõi thay đổi ở
  [#76](https://github.com/miuuyy/codex-chatgpt-web/issues/76)) — OpenAI có thể điều
  chỉnh, nhưng thứ tự Free < Plus < Pro ổn định. Nếu 28k là điểm nghẽn hằng ngày,
  **Plus (Medium/High ~80k) là nâng cấp đáng giá nhất**.

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

## 5b. Vận hành hằng ngày (bật / tắt / xem trạng thái)

Mọi lệnh chạy tại thư mục repo này.

```bash
docker compose up -d codex-chatgpt-web      # bật (build lại nếu thêm --build)
```

```bash
docker compose stop codex-chatgpt-web       # tắt, GIỮ container + dữ liệu
```

```bash
docker compose restart codex-chatgpt-web    # khởi động lại (áp dụng đổi env/route)
```

```bash
docker compose ps                           # trạng thái + healthy hay chưa
```

```bash
docker compose logs -f --tail 100 codex-chatgpt-web   # log realtime
```

Ba mức "tắt", chọn đúng cái bạn cần:

| Lệnh | Container | Volume (phiên đăng nhập) | Route trong `~/.codex/config.toml` |
| --- | --- | --- | --- |
| `stop` | dừng, còn nguyên | giữ | **giữ** — Codex vẫn trỏ vào bridge, gọi model sẽ lỗi khi container tắt |
| `down` | xoá container | giữ | **giữ** |
| `down -v` | xoá container | **xoá** (phải đăng nhập lại) | **giữ** |

> Vì route vẫn nằm trong config sau khi tắt, muốn **dùng model thường** thì phải gỡ route —
> xem mục 5c. Chỉ tắt container là chưa đủ.

Vài điều nên biết:

- Compose đặt `restart: unless-stopped`. Tắt bằng `stop` thì mở lại Docker Desktop **không**
  tự bật lại; nếu container đang chạy mà máy khởi động lại thì nó **tự bật**.
- Healthcheck gọi `/healthz` mỗi 30 giây, với `start_period` 15 phút để chừa thời gian
  đăng nhập lần đầu — nên `health: starting` ngay sau lần boot đầu là bình thường.
- Cả hai cổng chỉ bind vào máy bạn: `127.0.0.1:17841` (bridge) và `127.0.0.1:7900` (noVNC).
- Dữ liệu nằm ở volume `codex-chatgpt-web-home` → `/root/.codex-chatgpt-web` trong container:
  config, phiên đăng nhập ChatGPT, log, và `diagnostics/browser-turns/<trace>-<id>/` (ảnh +
  JSON trạng thái DOM từng bước của mỗi turn — rất hữu ích khi báo lỗi).
- Kiểm tra tổng thể bất cứ lúc nào:

  ```bash
  docker compose exec codex-chatgpt-web codex-chatgpt-web doctor
  ```

## 5c. Tạm ngưng bridge để dùng model thường — và nối lại

Route là **một dòng `openai_base_url`** trong `~/.codex/config.toml` trỏ toàn bộ traffic
OpenAI của Codex vào bridge. Còn dòng đó thì mọi model (kể cả `gpt-5.6-sol`) đều đi qua
container; container tắt là hỏng.

```bash
docker compose exec codex-chatgpt-web codex-chatgpt-web route status
```

```bash
docker compose exec codex-chatgpt-web codex-chatgpt-web route disconnect
```

```bash
docker compose exec codex-chatgpt-web codex-chatgpt-web route connect
```

- `disconnect` gỡ `openai_base_url` **và** các flag mà setup từng đặt
  (`remote_compaction_v2`, `multi_agent`, `multi_agent_v2`), theo journal riêng — nên sửa
  tay sẽ bỏ sót. `connect` đặt lại y nguyên, không phải cài lại từ đầu.
- Container **phải đang chạy** thì mới exec được. Nếu đã tắt: `up -d` → `route disconnect`
  → `stop`.
- **Thoát hẳn app Codex rồi mở lại** sau mỗi lần đổi route (đóng cửa sổ là chưa đủ).
- Sau `disconnect`, `route status` báo `installed: true, active: false` — đúng như vậy:
  vẫn còn cài, chỉ đang không nối.

## 6. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Màn hình noVNC đen | Bình thường — không có cửa sổ nào đang mở | Không cần làm gì; cửa sổ hiện khi đăng nhập/chạy turn |
| Google báo "browser không an toàn" | Google chặn browser trong container | Dùng email + mật khẩu hoặc mã qua email |
| Captcha Cloudflare hiện lại nhiều lần | Fingerprint tự động hóa | Tick captcha; nếu lặp >3 lần, khởi động lại container và thử lại |
| Codex không thấy model ChatGPT Web | Chưa restart Codex sau setup | Tắt hẳn Codex, mở lại |
| Turn báo lỗi login state missing/expired | Phiên ChatGPT hết hạn (~3 tháng) | `docker compose exec codex-chatgpt-web codex-chatgpt-web login` → đăng nhập qua noVNC → `docker compose restart codex-chatgpt-web` |
| Muốn đổi tài khoản ChatGPT | — | Như trên: chạy `login`, đăng nhập tài khoản mới, restart |
| Codex báo "ran out of room in the model's context window" (Luna) | Turn vượt trần ~28k của Free ngay cả sau khi tự cắt gọn | Xem `docker compose logs` để biết số token thật; cắt bớt `~/.codex/AGENTS.md`, mở thread mới, làm việc trên ít file hơn — hoặc dùng gói trả phí (mục 8) |
| Turn giao cho subagent bị từ chối | Đã tắt slimming, mà turn subagent mang gần trọn context cha nên vượt trần | Bật lại (bỏ `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES=off`) — xem mục 8d |
| Cùng một turn chạy lại lệnh 2–3 lần, giữa các lần có `Reconnecting` | Luna trả lời mà quên checkpoint riêng → bridge làm hỏng turn → Codex gửi lại nguyên turn → **mọi tool call trong đó chạy lại** | Đã sửa: bridge giờ hỏi lại checkpoint trong cùng chat thay vì làm hỏng turn. Nếu vẫn gặp, xem log tìm `could not recover its rolling checkpoint` |
| Model báo `turn_token` mất hiệu lực và xin bạn gửi thêm một tin nhắn, nhưng container không hề restart | Luna copy sai token của chính lượt đó — nó phải gõ lại 37 ký tự ngẫu nhiên vào mọi call, mất một ký tự là broker không nhận ra | **Tự phục hồi.** Khi chỉ có đúng một turn đang sống, bản copy lệch tối đa 2 ký tự vẫn được gắn vào turn đó (log ghi `recoveredTypo=N`). Chỉ còn từ chối khi có 2 turn cùng sống hoặc token sai quá nhiều |
| Model bảo việc gì đó "không thể làm được" — không có browser, không có tool, máy không cài gì | Nó kết luận theo phỏng đoán, hoặc dò máy Windows bằng lệnh POSIX rồi không thấy gì | Contract giờ buộc: mọi khẳng định về máy phải có kết quả tool, lệnh phải đúng OS của workspace, và phải tìm chương trình đã cài trước khi bảo là không làm được. Nếu vẫn từ chối, hỏi nó đã chạy lệnh gì |
| Turn chết với "ChatGPT failed the response itself and offered to regenerate it" | ChatGPT tự lỗi giữa lúc trả lời | Không cần làm gì — lỗi này retry được, Codex gửi lại turn. Bridge nhận diện qua nút regenerate của ChatGPT nên hoạt động với mọi ngôn ngữ giao diện |
| Model báo `turn_token` không hợp lệ / hết hạn / bị thu hồi, và nói không truy cập được repo | Container đã restart trong lúc turn đó đang chạy — token của broker chỉ nằm trong RAM nên mất hết sau restart (log ghi `liveTurns=0`) | **Không có gì hỏng.** Chỉ cần gửi thêm một tin nhắn trong cùng task Codex; turn mới sẽ được cấp token mới. Không cần restart task hay container |
| Turn chết với `stream disconnected before completion` rồi `Reconnecting` chạy lại | Luna viết lại đoạn văn đã stream sang Codex (thường là khi một tool call lỗi), mà delta của Responses không thu hồi được | Đã sửa: phần viết lại bị bỏ qua thay vì làm hỏng turn, các block sau vẫn stream tiếp. Log ghi `keeping the N block(s) Codex received` |
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

Mỗi turn Codex gửi lại **toàn bộ** thread (system prompt + instructions + mọi message +
mọi kết quả tool) dưới dạng **một** tin nhắn browser. Tài khoản Free giới hạn tin nhắn đó
~**28.000 token** (giới hạn transport, **không phải** cửa sổ 1M của model). Thread dài
bình thường sẽ rơi vào **vòng xoáy chết**: turn tràn → không ghi được checkpoint → turn sau
lại gửi nguyên lịch sử quá khổ → tràn tiếp, lặp vô hạn.

Fork này phá vòng đó bằng cách tự cắt **bản sao gửi vào browser** (không đụng file trên máy,
không ảnh hưởng Codex dùng model thường), chỉ với model Luna, và chỉ khi turn thực sự vượt
trần. Cắt theo tầng, dừng ngay khi vừa 28k:

1. **Bỏ các khối quy tắc harness-only.** Các section `## Rule:` kiểu ClaudeKit — bảng
   routing skill `/ck:`, hook protocol, luật Agent Team — là chỉ dẫn cho harness khác mà
   model Web không thực thi được, nên bị bỏ ở mọi turn Luna.
2. **Tóm tắt các quy tắc còn lại** về tiêu đề + đoạn mở đầu.
3. **Gộp lịch sử cũ** — đây là bước cứu thread rất dài. Thay vì để lại một ghi chú
   "[trimmed]" cho **mỗi** message cũ (hàng trăm ghi chú như vậy tự nó đã tốn hàng chục
   nghìn token), bridge **xóa hẳn cả đoạn cũ và thay bằng đúng MỘT marker**, ví dụ
   `[bridge removed 1,063 older message(s) (~1,097,773 tokens) …]`. Giữ nguyên các message
   gần nhất + round đang chạy dở, và thu hẹp cửa sổ giữ lại dần dần (8 → 4 → 2 → 1 message
   gần nhất, chỉ gộp cả developer contract cũ ở bước sâu nhất) cho tới khi turn vừa —
   gần như chỉ còn turn hiện tại, tức tương đương việc bạn tự "clear thread" nhưng làm tự động.

Một thread thật ~**1,12 triệu token** nén xuống **~14k** theo cách này và chạy bình thường.
usage báo về Codex là con số sau khi cắt nên Codex cũng không tự loại bỏ thread. Dòng ✂️
hiện trong trace của Codex khi việc cắt đã "cứu" một turn quá khổ; các lần cắt thông thường
ghi trong log container (`docker compose logs`). Nếu cắt hết mức mà vẫn vượt, log ghi rõ
khối nào còn nặng bao nhiêu.

**Đánh đổi:** model không còn thấy toàn văn lịch sử đã gộp — nó làm việc dựa trên các turn
gần nhất + **checkpoint cuộn của Luna** (bản tóm tắt gọn mà bridge tự duy trì). Nên thread
sống và mạch lạc để làm tiếp, nhưng nếu cần model nhớ chính xác chi tiết từ rất xa trong
thread đã gộp thì không đáng tin — lúc đó mở thread mới sạch hơn.

Tùy biến danh sách section bị cắt qua biến môi trường
`CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` (danh sách tên cách nhau dấu phẩy; đặt `off` để tắt).

### 8b. Preload: chia nhiều tin nhắn thay vì gộp mất mát (bật mặc định)

Gộp lịch sử ở bước 3 là **có mất mát** — model không còn thấy toàn văn. Nên trước khi gộp,
bridge thử một cách khác: **chia turn quá khổ thành nhiều tin nhắn** gửi lần lượt **vào cùng
một chat**, mỗi tin nhắn nằm trong trần 28k, rồi tin nhắn cuối mới là task. Model tích lũy
dần cả thread trong cửa sổ ~1M của nó, nên không mất gì cả.

Vài điểm cần biết:

- Chỉ kích hoạt với **turn vượt trần**; turn vừa 28k đi nguyên một tin nhắn như cũ.
- Các section `## Rule:` **do bạn viết** được mang **nguyên văn** trong phần preload thay vì
  bị tóm tắt — vì preload chạy **trước** bước tóm tắt quy tắc.
- Trần **3 phần** (`CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS`). Lý do là đo được: ChatGPT
  Free **ngừng phản hồi sau khoảng 3 tin nhắn gửi nhanh liên tiếp trong một chat**, và triệu
  chứng là **im lặng, không báo lỗi**. Turn cần nhiều hơn 3 phần sẽ quay về cách gộp.
- Nếu giao preload thất bại giữa đường, turn được gửi lại **một lần** dưới dạng một tin nhắn
  đã cắt gọn — nên preload không bao giờ tệ hơn gộp.
- Dòng `📨` trong trace Codex cho biết turn đã bị chia làm mấy phần.

Tắt bằng `CODEX_CHATGPT_WEB_LUNA_PRELOAD=off`.

### 8c. Nhớ lại nguyên văn phần đã nén (chỉ full mode)

Checkpoint cuộn là **bản tóm tắt**, nên một chi tiết chính xác từ xa (một đường dẫn, một tag
deploy, output một lệnh) có thể rơi ra khỏi nó. Ở **full mode**, bridge giữ nguyên văn phần
lịch sử đã bị nén trong **RAM phạm vi turn** và nói cho model biết nó **có thể** lấy khi cần:

- Model làm việc trên bản tóm tắt như bình thường.
- Khi cần chi tiết mà bản tóm tắt không có, nó gọi `codex_tool_call` với
  `__codex_search_collapsed_history_v1` để tìm, rồi `__codex_load_collapsed_history_v1` để
  đọc nguyên văn.
- Cơ chế này **tùy chọn**: turn nào không cần thì hoàn toàn không thay đổi gì. Kho nhớ là
  **chỉ đọc**, bị xoá khi turn kết thúc, và không thêm tool, quyền, hay đường vào máy bạn.

Đã kiểm chứng thật: một giá trị gieo ở turn đầu, bị tóm tắt mất ở các turn sau, đã được đọc
lại **chính xác** sau khi model tự gọi tool (`history search matches=2/8` trong log). Chế độ
browser-only và Pro (read-only) không có kho nhớ này.

### 8d. Subagent của Codex chạy được — và slimming là điều kiện để nó chạy

Codex có cơ chế **delegate** riêng, và setup của fork này **đã bật sẵn**: nó ghi
`multi_agent = true` vào `~/.codex/config.toml` (kèm `multi_agent_v2 = false`, vì V2 mã hoá
payload giữa các backend mà bridge cần đọc được).

Mỗi subagent Codex sinh ra là **một task Codex đầy đủ**, nên nó có turn riêng → **chat
Temporary riêng → ngân sách 28k riêng → và tool cục bộ thật**. Nghĩa là bạn không cần bất kỳ
cơ chế subagent tự chế nào; cứ yêu cầu Codex chia việc là được.

Đã kiểm chứng trên tài khoản **Free**: một task giao cho hai subagent đã tạo ra **ba browser
turn chạy song song**, và cả hai turn con đều hoàn tất.

**Điều quan trọng phải biết:** mỗi turn subagent mang theo **gần như toàn bộ context của
turn cha**. Trong lần đo, cả hai turn con đến bridge ở mức **~32.100 token — vượt trần
28.000 của Free** — và chúng chỉ vừa được vì slimming đã cắt các khối rule harness-only
(~3.900 token) xuống còn ~27.900. Nên trên tài khoản Free, slimming **không chỉ** để cứu
thread dài: nó là **điều kiện để subagent của Codex chạy được**. Nếu bạn tắt nó
(`CODEX_CHATGPT_WEB_LUNA_TRIM_RULES=off`), hãy chờ đợi các turn delegate bị từ chối.

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

## 10b. Bảng setting đầy đủ (biến môi trường)

Đặt trong khối `environment:` của `docker-compose.yml`, hoặc thêm vào trước lệnh khi bật:

```bash
CODEX_CHATGPT_WEB_LUNA_PRELOAD=off docker compose up -d codex-chatgpt-web
```

PowerShell không có cú pháp tiền tố đó — dùng `$env:TÊN = "giá trị"` rồi mới chạy lệnh.
Đổi biến xong phải `up -d` lại (hoặc `restart`) thì container mới đọc giá trị mới.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `REPLACE_CODEX_ROUTE` | `0` | Đặt `1` cho lần boot đầu nếu `~/.codex/config.toml` đã có sẵn `openai_base_url` khác; setup sẽ thay thế **có thể hoàn tác** |
| `CODEX_CHATGPT_WEB_LUNA_PRELOAD` | `on` | Turn vượt trần được chia thành nhiều tin nhắn thay vì gộp mất mát (mục 8b). `off` để tắt |
| `CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS` | `3` | Số phần tối đa khi preload. Free ngừng phản hồi sau ~3 tin nhắn gửi nhanh — chỉ tăng khi test |
| `CODEX_CHATGPT_WEB_LUNA_PRELOAD_TIMEOUT_MS` | `180000` | Hạn chờ xác nhận mỗi phần preload (tối thiểu 5000). Hạ xuống để test nhánh thất bại |
| `CODEX_CHATGPT_WEB_LUNA_BUDGET_OVERRIDE` | trống (28k thật) | Hạ ngưỡng kích hoạt slimming/preload (tối thiểu 1000) để test trên thread ngắn. **Không bao giờ nâng được** trần thật |
| `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` | 5 section mặc định | Danh sách `## Rule:` bị cắt, cách nhau dấu phẩy; `off` để tắt hẳn slimming (mục 8, 8d) |
| `CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS` | tắt | `1` = chụp diagnostic ở **mọi** checkpoint, không chỉ khi lỗi. Tốn dung lượng, chỉ bật khi đang truy lỗi |
| `CODEX_CHATGPT_WEB_HOME` | `~/.codex-chatgpt-web` | Đổi thư mục dữ liệu. Trong container đã trỏ vào volume — đừng đổi trừ khi chạy ngoài Docker |

Setting **không** nằm ở biến môi trường mà ở lệnh `setup` (xem 10c): chế độ
browser-only/full, cổng, tên connector, tunnel id, auto-approve tool call.

## 10c. Lệnh CLI đầy đủ

Chạy trong container: `docker compose exec codex-chatgpt-web codex-chatgpt-web <lệnh>`
(thêm `-it` khi lệnh cần nhập liệu, ví dụ `tunnel key-import`).

| Lệnh | Dùng khi nào |
| --- | --- |
| `setup --browser-only [options]` | Cài/chuyển về chế độ chỉ đọc ngữ cảnh, không tool cục bộ |
| `setup --full --tunnel-id ID …` | Chuyển sang full mode có tool cục bộ (mục 9) |
| `login` | Phiên ChatGPT hết hạn hoặc đổi tài khoản; đăng nhập qua noVNC |
| `doctor [--json]` | Báo cáo sức khoẻ tổng thể: route, login, tunnel, service |
| `route <status\|connect\|disconnect>` | Nối/ngưng route trong `~/.codex/config.toml` (mục 5c) |
| `browser check` | Kiểm tra Chromium trong container mở được không |
| `serve` | Chạy bridge ở tiền cảnh (entrypoint đã tự làm) |
| `mcp [--broker-socket PATH]` | Tiến trình MCP phục vụ connector (bridge tự gọi) |
| `service <status\|install\|start\|restart\|stop\|cancel-turns>` | Quản lý daemon; `cancel-turns` huỷ mọi browser turn đang treo |
| `tunnel <status\|key-import>` | Trạng thái tunnel, nhập runtime key. `start/stop/restart` bị chặn trong container — restart container thay thế |
| `open <tunnels\|runtime-keys\|connectors>` | Mở trang cấu hình tương ứng trên OpenAI/ChatGPT |
| `uninstall --yes` | Gỡ toàn bộ tích hợp khỏi Codex |

Cờ `setup` hay dùng: `--port` (mặc định 17841), `--app-name` (tên connector), `--login`
(làm mới đăng nhập), `--refresh-account-capabilities` (đọc lại gói tài khoản sau khi nâng
cấp), `--auto-approve-tool-calls` (tự bấm "Allow once"), `--replace-codex-route`,
`--acknowledge-unofficial` (bắt buộc một lần).

## 10d. Đọc log: các dấu hiệu quan trọng

```bash
docker compose logs --tail 200 codex-chatgpt-web | grep "chatgpt-web]"
```

| Dòng log | Nghĩa |
| --- | --- |
| `browser turn <id> opened (promptChars=…, estimatedInputTokens=…)` | Turn bắt đầu; con số token thật để đối chiếu trần 28k |
| `stage=… completed durationMs=…` | Từng bước: chuẩn bị chat → chọn effort → gắn connector → gửi |
| `broker claim received (tokenChars=37, valid=true)` | Model gọi tool cục bộ với token hợp lệ |
| `valid=true, recoveredTypo=N` | Model gõ sai token N ký tự, bridge **tự sửa** — không mất turn |
| `valid=false, …, liveTurns=0` | Không còn turn nào sống → bridge đã restart giữa lượt; gửi thêm một tin nhắn |
| `valid=false, …, liveTurns=1` | Bản copy hỏng quá nặng; model được yêu cầu đọc lại token và gọi lại |
| `keeping the N block(s) Codex received` | Model viết lại đoạn đã stream; phần viết lại bị bỏ, **turn vẫn sống** |
| `response DOM snapshot failed …` | Lỗi trong hàm đọc DOM (không phải "ChatGPT chưa trả lời") — kèm nguyên văn lỗi |
| `Luna rolling checkpoint applied=true replacedHistory=N` | Đã thay N message cũ bằng checkpoint cuộn |
| `could not recover its rolling checkpoint` | Luna quên checkpoint và hỏi lại cũng không được — turn sẽ hỏng |
| `turn failed: …` | Lý do turn hỏng, nguyên văn |

Trong trace của **app Codex** (không phải log container): dòng `✂️` nghĩa là slimming vừa
cứu một turn quá khổ, dòng `📨` cho biết turn bị chia làm mấy phần preload.
