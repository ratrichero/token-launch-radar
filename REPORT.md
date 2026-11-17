# REPORT — Phase 1: model v2 + board (token-radar-01)

Người điều phối: Muse. Agent hoàn thiện báo cáo: OpenCode 1.19.5, model
DeepSeek-V4.1-Flash qua AMD Token Lab. Phase 1 là công việc của phiên build chính
(model Top-Tools-Ai-Pro); phiên này chỉ kiểm chứng lại, viết REPORT.md và chạy
gate lần cuối. **Không sửa model hay board** — mọi số liệu dưới đây đọc trực tiếp từ
`out/board.json` và `out/data.js` (bảng `window.RADAR.peer_table`).

Input: `kit/token-radar-01-kit/input/snapshot.json`
- `as_of` = 2026-11-14, `floor_usd` = 50,000,000 (sàn pre-token), `source` = DefiLlama
  (`https://api.llama.fi/protocols`, fetched 2026-11-14T01:18:33Z).
- 758 protocol, `watchlist` = 40 slug (rule của house: TVL ≥ sàn, không token, không
  là sản phẩm wrapped/staked/bridged của token đã trade, không CEX, không hậu tố version).

## 1. Công thức model v2 (`lib/model.ts`, `MODEL_VERSION = 'radar-2'`)

Khác hẳn starter (starter dùng hệ số phẳng 0.25). Mỗi dòng pre-token được chấm:

```
implied_value_usd = round( TVL_usd
                         × peer_multiple(category)
                         × growth_multiplier
                         × maturity_multiplier
                         × chain_multiplier )
```

kẹp tối thiểu `max(1, …)`, làm tròn về số nguyên đô-la. `implied_value_usd` là **claim
của entry**, không phải giá make.fun công bố.

### 1. Suy bội số từ peer — `peer_multiple(category)`
- Peer = protocol trong **chính snapshot** đã có token và có cả TVL, mcap:
  `mcap_usd` và `gecko_id` và `symbol` đều khác null, `mcap_usd > 0`, `tvl_usd > 0`.
- Mỗi tỉ lệ `r = mcap_usd / tvl_usd` được **winsorised** vào `[0.01, 1.00]`
  (`PEER_WINSOR_LO/HI`) rồi lấy **trung vị** theo category → `catMedian`.
- **Co về trung vị toàn cục (shrinkage, James–Stein kiểu 3 mẫu ảo):**

  ```
  shrunk = (n × catMedian + 3 × globalMedian) / (n + 3)      # n = số peer của category
  peer_multiple = clamp(shrunk, 0.05, 0.80)        # MULTIPLE_CLAMP_LO/HI = 0.05 / 0.80
  ```

Category không có peer nào (không xuất hiện trong bảng peer) → dùng
`globalMedian` kẹp `[0.05, 0.80]` (peer_count = 0). `globalMedian` là trung vị winsorised
trên **toàn bộ 128 peer** (mọi protocol có token trong snapshot): **0.213803**
(làm tròn 4 chữ số = 0.2138; brief ghi 0.2227 là số đo tham khảo trước đó — số thật
do model tính trên snapshot này là 0.213803, công bố trong báo cáo để đối chiếu).

### 2. `growth_multiplier`
`change_7d` kẹp vào `[-60, 120]`; thiếu `change_7d` coi là 0. Phạt giảm nặng hơn
thưởng tăng:

```
growthPct = clamp(change_7d ?? 0, -60, 120)
growth_multiplier = 1 + growthPct/100 × (growthPct >= 0 ? 0.4 : 0.9)
```

→ khoảng `[0.46, 1.48]` (đã kiểm trên board: min 0.46, max 1.48).

### 3. `maturity_multiplier` (theo tuổi protocol)
Tuổi = ngày kể từ `listed_at` tới `as_of`, kẹp tối đa **1095 ngày (3 năm)**; không rõ
`listed_at` → **365 ngày**.

```
maturity = 0.65 + min(max(age_or_365, 0), 1095)/1095 × 0.35     # [0.65, 1.00]
```
Board thực tế: `0.6506 .. 1.0`.

### 4. `chain_multiplier`
```
chain_multiplier = 1 + 0.04 × min(max(#chains - 1, 0), 5)       # [1.00, 1.20]
```
Board thực tế: `1.0 .. 1.2` (protocol có 1 chain → 1.0, từ 6 chain trở lên → 1.2).

### Không hardcode protocol
Cùng một hàm `impliedValue` + `getPeerMultiple` chấm mọi dòng; chỉ category+chain+tuổi+TVL
đi vào. Không có tên protocol nào trong `lib/model.ts` (chỉ text `farm_steps` sinh từ
template theo category, không ảnh hưởng điểm).

## 2. Bảng `peer_multiple` theo category (số thật trong `out/data.js`)

`data.js` phát ra `peer_table` gồm 34 category đã làm tròn 4 chữ số; dưới đây là **toàn bộ
34 dòng** (category, peers, catMedian, multiple), sắp theo `multiple` giảm dần đúng như
model xuất. Trung vị toàn cục = 0.213803, 128 peer.

| # | Category | peers | catMedian | peer_multiple |
|---|----------|-------|-----------|---------------|
| 1 | Privacy | 3 | 0.9691 | 0.5915 |
| 2 | Canonical Bridge | 8 | 0.6834 | 0.5553 |
| 3 | Derivatives | 2 | 1.0000 | 0.5283 |
| 4 | Basis Trading | 7 | 0.6544 | 0.5222 |
| 5 | Cross Chain Bridge | 4 | 0.6180 | 0.4448 |
| 6 | Bridge | 6 | 0.5567 | 0.4424 |
| 7 | Chain | 1 | 1.0000 | 0.4104 |
| 8 | Collateral Management | 1 | 1.0000 | 0.4104 |
| 9 | Decentralized AI | 1 | 1.0000 | 0.4104 |
| 10 | NFT Marketplace | 1 | 1.0000 | 0.4104 |
| 11 | Options | 1 | 1.0000 | 0.4104 |
| 12 | Prediction Market | 1 | 0.7373* | 0.4104 |
| 13 | Risk Curators | 1 | 1.0000 | 0.4104 |
| 14 | AI Agents | 2 | 0.6047 | 0.3702 |
| 15 | Token Locker | 2 | 0.5326 | 0.3413 |
| 16 | Dexs | 11 | 0.3424 | 0.3149 |
| 17 | RWA | 9 | 0.2748 | 0.2595 |
| 18 | Leveraged Farming | 1 | 0.1725 | 0.2035 |
| 19 | Liquid Restaking | 2 | 0.1828 | 0.2014 |
| 20 | Payments | 2 | 0.1813 | 0.2008 |
| 21 | Yield | 9 | 0.1914 | 0.1970 |
| 22 | Launchpad | 1 | 0.1306 | 0.1930 |
| 23 | CDP | 3 | 0.1687 | 0.1913 |
| 24 | DOR | 1 | 0.0898 | 0.1828 |
| 25 | Indexes | 3 | 0.1477 | 0.1807 |
| 26 | Yield Aggregator | 4 | 0.1510 | 0.1779 |
| 27 | Dual-Token Stablecoin | 1 | 0.0316 | 0.1683 |
| 28 | Liquidity Manager | 1 | 0.0150 | 0.1641 |
| 29 | Lending | 15 | 0.1324 | 0.1460 |
| 30 | Restaking | 2 | 0.0246 | 0.1381 |
| 31 | Onchain Capital Allocator | 2 | 0.0146 | 0.1341 |
| 32 | Staking Pool | 2 | 0.0100 | 0.1323 |
| 33 | CEX | 9 | 0.0748 | 0.1096 |
| 34 | Liquid Staking | 9 | 0.0406 | 0.0839 |

`*` Giá trị `catMedian` của `Prediction Market` là 1.0000 (console in `1`, chỉ một peer
có tỉ lệ ≥ 1.00 nên winsorised về 1.0). Sửa lại cho đúng: 1.0000. Các dòng có
`catMedian = 1.0000` là nhóm chỉ 1 peer với tỉ lệ ≥ 1.0 (kẹp trần 1.0) nên category đó
vẫn bị shrinkage kéo về gần globalMedian; vì vậy nhiều category 1-peer cùng ra
`multiple = 0.4104`. CEX / Liquid Staking có mặt trong bảng peer (để đo) nhưng
**không** được xếp vào board (`isRankable` loại CEX; Liquid Staking thường nằm dưới sàn
hoặc không phải pre-token).

## 3. Thống kê board (`out/board.json` — 226 dòng)

- Tổng rows: **226** (100–4000 ✓). Rank liền mạch **1..226**. Implied **giảm dần**, **226
  giá trị phân biệt** (không dòng nào bằng nhau, không bằng phẳng).
- Implied cao nhất `steakhouse-financial` = **1,094,803,096** (≈ $1.095B); thấp nhất
  hàng 226 = **356,779** (≈ $0.357M). Tất cả ≤ 1e14 ✓.
- Phân nhóm (theo `data.js`): `watchlist_size` = **40**, `board_size` = **226**,
  `early_size` = **186** (dưới sàn $50M), `live_size` = **24** (chỉ để so sánh, lưu mảng
  `live`, không xếp vào board).
- Toàn bộ 186 dòng early có TVL **< $50M** (max early TVL = 49,631,964), đúng sàn.
- Board phủ **34 category**; 23 category có mặt trong `peer_table`, 11 category
  không có peer (dùng `globalMedian` fallback): Collateral Markets, Stablecoin
  Wrapper, CeDeFi, Farm, Governance Incentives, Insurance, Anchor BTC, Crypto Card
  Issuer, Decentralized BTC, Uncollateralized Lending, Interest Rate Derivatives.

### Top 10 (rank, name, slug, category, implied_value_usd)

| rank | name | slug | category | implied_value_usd |
|------|------|------|----------|-------------------|
| 1 | Steakhouse Financial | steakhouse-financial | Risk Curators | 1,094,803,096 |
| 2 | Gauntlet | gauntlet | Risk Curators | 654,262,608 |
| 3 | Veda | veda | Onchain Capital Allocator | 198,368,603 |
| 4 | USDD | usdd | CDP | 179,683,957 |
| 5 | Nonce Capital | nonce-capital | Risk Curators | 132,909,526 |
| 6 | RockawayX | rockawayx | Risk Curators | 101,960,160 |
| 7 | Hyperithm | hyperithm | Risk Curators | 86,344,273 |
| 8 | K3 Capital | k3-capital | Risk Curators | 77,486,249 |
| 9 | Bittensor dTAO | bittensor-dtao | Dexs | 74,410,852 |
| 10 | Upshift | upshift | Onchain Capital Allocator | 72,774,011 |

Các bội số thực của top 3 (kiểm lại công thức):
- #1 Steakhouse: peer_multiple 0.4104 (Risk Curators), growth ×0.9803, maturity
  ×0.8236, chain ×1.20 → 2,753,981,495 × 0.4104 × 0.9803 × 0.8236 × 1.20 ≈ 1.0948e9.
- #2 Gauntlet: 0.4104 × 1.0226 × 0.8236 × 1.20.
- #3 Veda: 0.1341 (Onchain Capital Allocator) × 0.9254 × 0.8520 × 1.20.

## 4. Kiểm gate (`tools/check-gate.mjs out ../kit/.../snapshot.json`)

Output thật (8 mục, PASS hết):

```
PASS  dashboard_files - 3 files, 2350 bytes
PASS  board_file - 226 rows, valid slugs
PASS  sorted_by_value - ranks 1..226, 226 distinct implied values
PASS  coverage - all 40 watchlist slugs present
PASS  farm_steps - all 226 rows have 3-12 steps of 20-600 chars
PASS  screenshots - 3 images OK
PASS  dossier_matches - 41469 bytes, byte-identical
PASS  dossier_text_cap - 2605 bytes of text

8/8 gate checks passed
```

Ghi chú: `competition.yaml` mô tả gate là **7 nhóm** theo scorer; script `check-gate.mjs`
của entry tách `dossier_matches`/`dossier_text_cap` nên in **8 dòng** — nội dung tương
đương, đều pass.)

### Kiểm độc lập
- **Coverage 40/40**: đọc `snapshot.watchlist` (40 slug, đều unique) đối chiếu set slug
  board → **40 có mặt, 0 thiếu**. Khớp dòng `coverage` của gate.
- **Tái tạo board**: gọi lại `buildRadar(parseSnapshot(snapshot.json))` từ
  `lib/model.ts` → JSON rows **trùng byte** với `out/board.json` (226 dòng). Xác nhận
  board đúng là output của model hiện tại, không chỉnh tay.
- **Determinism**: chạy 2 lần đã ra `out/` và `out2/`. So byte: `board.json`,
  `data.js`, `dossier.json` và cả 3 PNG trong `screenshots/` **trùng khít** (`cmp` không
  in gì) → byte-identical.
- **No-network**: không file nào trong `out/dashboard/` chứa `http://`/`https://`
  (grep rỗng).
- **No secrets**: grep `api_key|secret|private_key|sk-…|0x[a-f0-9]{40}` trên repo →
  rỗng. Không đọc/ghi `wallet.json` (ngoài repo, cấm địa).

## 5. Còn thiếu cho Phase 2

Phase 1 chỉ cần placeholder chạy trọn vòng; gate pass nhưng **nội dung thật còn thiếu**:

1. **Dashboard thật** — hiện `dashboard/index.html`, `app.js`, `app.css` là *placeholder*
   (title ghi rõ "PLACEHOLDER (Phase 1)", header "Phase 1 placeholder dashboard - Phase 2
   ships the full UI"). Đã có `data.js` với `window.RADAR` (226 rows + 24 live + peer_table)
   để dựng: board bảng xếp hạng có sort/filter, trang chi tiết protocol (model breakdown:
   peer/growth/maturity/chain, farm steps), view lọc theo category/chain/giá trị. Cần giữ
   source < 64 KB và không có URL http(s) trong attribute/import.
2. **3 ảnh chụp thật** — đây là điểm sai lệch lớn nhất cần sửa:
   - `screenshots/1-board.png`, `2-detail.png`, `3-filtered.png` (và bản trong `out/`) **KHÔNG
     phải ảnh chụp dashboard**. Chúng do `tools/gen-screenshots.mjs` sinh bằng
     `deflateSync`: mỗi ảnh là một khung **1440×800 tô màu đặc** (RGB nền tối, có vài mảng
     chữ nhật màu cho "board/detail/filtered"), không chứa chữ, không render HTML nào.
   - Đối chiếu starter (`kit/.../starter/screenshots/`): md5 starter là
     `eed03c..`/`34dfbf..`/`ae1f27..`; md5 trong repo là `fad9a8..`/`1256dd..`/`882d7f..`
     → **không phải bản sao starter**, mà là ảnh synthetic do script trên tạo. (Bối cảnh
     brief nói "bản sao từ starter"; kiểm thật thì là ảnh tự sinh — cần thay.)
   - Phase 2 phải mở dashboard bằng Chrome/Chromium headless, chụp **3 ảnh thật**:
     (a) toàn board, (b) chi tiết một protocol, (c) view đã lọc. Mỗi ảnh 300–350 KB, ≤ 512
     KiB, long side ≤ 1440, short side ≥ 800. Sau đó thay vào `screenshots/`, chạy lại
     `main.ts`, và `dossier.json` sẽ tự khớp (gate `dossier_matches`/`screenshots` sẽ thay
     đổi theo ảnh thật).
3. **Gate 7 nhóm của scorer** (score.ts) chỉ có thể chạy trên `/output` cuối sau khi có
   ảnh thật; hiện `check-gate.mjs` local đã pass 8/8 nhưng ở dạng placeholder.

## 5. Trạng thái commit

Repo hiện **chưa có commit nào** (`main` unborn); mọi file còn untracked. Chưa
`commit`/`push` gì — chờ điều phối viên duyệt (đúng brief).

> Cập nhật 17/11: Phase 1 đã được điều phối viên duyệt và push thành commit
> `30273f1` (branch `main`, remote `gh443`). Phase 2 chưa commit — chờ duyệt.

## 6. Phase 2 — dashboard thật, 3 ảnh thật, README/LICENSE, gate (17/11)

Mọi số dưới đây đo trực tiếp từ file trong repo sau khi chạy lại `main.ts`.
**Không sửa `main.ts`; `lib/model.ts` chỉ thêm đúng 4 dòng** (đưa
`farm_steps` vào `RadarRow` + khoá `watchlist` — xem 6.4, 6.6), **không đổi
công thức, không đổi số liệu** — số implied giữ nguyên (Steakhouse vẫn
**1,094,803,096**; `out/board.json` so với commit `30273f1` trùng byte).

### 6.1. Dashboard mới (`dashboard/`) thay placeholder Phase 1

Một trang tĩnh dark, 5 view, dữ liệu 100% từ `data.js` (`window.RADAR`),
không fetch, không URL `http(s)` nào trong source:

- **Board** — bảng 226 dòng (rank, name + pill "watchlist", category, chips
  chain, TVL, 7d, age, implied); sort rank/TVL/implied/7d (đảo chiều được),
  filter 34 category + filter chain, search name/slug, toggle "Watchlist 40
  only", Reset. Mỗi dòng mở bằng click hoặc Enter.
- **Detail** (`#slug`) — model breakdown đầy đủ: công thức
  `implied = round(TVL × peer_multiple × growth × maturity × chain)` với số
  thật của chính dòng đó (Steakhouse: `$2,753,981,495 × 0.4104 × 0.9803 ×
  0.8236 × 1.2000 = $1,094,803,096` — khớp §3 Phase 1), bảng 4 multiplier,
  box "Priced against its category" (median peer của category + live tokens
  cùng category), farm steps.
- **Live tokens** — 24 token đã có mcap/TVL, để so sánh, không xếp hạng.
- **Peer multiples** — bảng 34 category kèm bar `multiple`.
- **Value model** — công thức + cách đọc board.

Routing bằng hash: `#slug`, `#live`, `#peers`, `#model`, `#category=…`,
`#chain=…`, `#q=…`, `#watch`.

Kiểm render (Playwright chromium-1243, viewport 1440×800, `colorScheme:
dark`): **0 console/page error** trên cả 3 view được chụp; board in "226 of
226 pre-token protocols", top $1.09B Steakhouse Financial, stats "On the
watchlist 40"; view lọc `#category=Risk%20Curators` in "33 of 226 pre-token
protocols · Risk Curators" và 33/33 dòng cùng category; detail hiển thị đúng
công thức và số liệu thật.

### 6.2. Kích thước source dashboard

| file | Phase 1 (placeholder) | Phase 2 |
|------|----------------------:|--------:|
| `index.html` | — | 3,362 B |
| `app.css` | — | 8,643 B |
| `app.js` | — | 23,982 B |
| **Tổng (3 files)** | **2,350 B** | **35,987 B** |

Cách xa cap 4 MiB của dossier; gate `dashboard_files` PASS.

### 6.3. Ba ảnh chụp thật (thay ảnh synthetic 2 màu của Phase 1)

Chụp bằng `node tools/shoot.mjs` (Playwright chromium-1243 headless, viewport
1440×800, dark) từ `out/dashboard/` đang chạy trên `out/data.js` thật:

| ảnh | nội dung | kích thước | dung lượng |
|-----|----------|-----------|-----------:|
| `screenshots/1-board.png` | toàn board: 226 dòng, stats 40 watchlist, top $1.09B | 1440×800 | **147,243 B** (143.8 KiB) |
| `screenshots/2-detail.png` | detail Steakhouse Financial: công thức, 4 multiplier, peer box, đủ 7 farm steps | 1440×800 | **210,147 B** (205.2 KiB) |
| `screenshots/3-filtered.png` | board lọc Risk Curators: đủ tiêu đề + stats, 33/33 dòng | 1440×800 | **175,744 B** (171.6 KiB) |

Bảng trên là 3 ảnh **chụp lại ngày 17/11 ~12:22**, sau khi sửa lỗi
`farm_steps` (mục 6.6) và thêm scroll về đầu trang trong `tools/shoot.mjs`;
`1-board.png` giữ nguyên dung lượng 147,243 B.

Tất cả ≤ 512 KiB, đúng ràng buộc của scorer (long side ≤ 1440, short side ≥
800). Kiểm "bằng mắt" thay bằng đo (model phiên này không nhận ảnh):
- DOM text render ra đúng chữ và số liệu thật (mục 6.1).
- Phân tích pixel PNG: ảnh mới có **3,271–4,421 màu RGB khác nhau**, ảnh
  synthetic cũ chỉ **2 màu** → chắc chắn là UI render thật, không phải khung
  màu đặc.
- `shoot.mjs` có 2 chỉnh sửa so với bản đầu Phase 2: (1)
  `deviceScaleFactor: 2` → `1` — với 2, ảnh ra 2880×1600 vi phạm "long side
  ≤ 1440", brief cho phép hạ về 1 khi cần; (2) **scroll về đầu trang trước
  khi chụp** — thêm khi chụp lại 17/11 ~12:22 để ảnh 3 hiện đủ tiêu đề +
  stats. Ảnh 1440×800 thật ra nhẹ (144–205 KiB) vì nền dark ít chi tiết,
  vẫn dưới cap 512 KiB và gấp ~10 lần ảnh synthetic cũ.

### 6.4. Thay đổi trong `out/data.js` so với Phase 1

So `window.RADAR` của `out/data.js` mới với bản trong commit `30273f1` (parse
và so từng khoá):

- `out/board.json`: **trùng byte** với Phase 1 (226 dòng, mọi implied giữ
  nguyên).
- `out/data.js`: các khoá Phase 1 (`as_of, board_size, early_size,
  floor_usd, live, live_size, model_version, peer_table, source,
  watchlist_size`) **trùng khớp**; thêm khoá **`watchlist`** = mảng 40 slug,
  trùng `snapshot.watchlist` (dashboard cần để hiện số 40 ở stats, pill và
  toggle); và mỗi dòng trong `rows` thêm trường **`farm_steps`** (226 dòng →
  226 lần `farm_steps` trong file) — do sửa lỗi ở mục 6.6. Mọi số implied,
  multiplier trong `rows` giữ nguyên.

### 6.5. Gate + determinism (trạng thái cuối, sau khi đổi ảnh)

`node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json --output
out` rồi `node tools/check-gate.mjs out ../kit/token-radar-01-kit/input/snapshot.json`:

```
PASS  dashboard_files - 3 files, 35987 bytes
PASS  board_file - 226 rows, valid slugs
PASS  sorted_by_value - ranks 1..226, 226 distinct implied values
PASS  coverage - all 40 watchlist slugs present
PASS  farm_steps - all 226 rows have 3-12 steps of 20-600 chars
PASS  screenshots - 3 images OK
PASS  dossier_matches - 748801 bytes, byte-identical
PASS  dossier_text_cap - 36253 bytes of text

8/8 gate checks passed
```

Bản gate in trên là lần chạy cuối: sau khi sửa `farm_steps` (6.6) và chụp
lại 3 ảnh (17/11 ~12:22); dossier **748,801 B**, byte-identical.

- **Determinism**: chạy thêm lần 2 vào `out2/`, so 5 artefact
  (`board.json`, `data.js`, `dossier.json` + 3 PNG) → **trùng byte cả 2 lần**
  (lần 1 trước khi đổi ảnh, lần 2 sau khi đổi ảnh); `out2/` đã xoá (nằm trong
  `.gitignore`).
- **README.md** (mới, gốc repo): 3 badge live của make.fun theo RULES.txt —
  `https://make.fun/badge/token-radar-01.svg`,
  `https://make.fun/badge/token-radar-01/ratrichero/token-launch-radar/rank.svg`,
  `.../reward.svg` — không còn placeholder `{owner}`, kèm link trang
  competition `https://make.fun/c/token-radar-01/`, mô tả ngắn, cách chạy.
- **LICENSE** (mới): MIT, copy nguyên chữ từ `kit/starter/LICENSE`
  ("Copyright (c) 2026 the make.fun team").
- **No secrets**: không file mới nào chứa key/secret; không đọc/ghi
  `wallet.json`.

### 6.6. Lỗi `farm_steps` trống trong panel detail — phát hiện 17/11, đã sửa

- **Phát hiện**: sau bản chụp đầu, điều phối viên mở ảnh kiểm bằng mắt và
  thấy panel detail **không hiện phần farm steps** của Steakhouse, dù công
  thức, 4 multiplier và peer box đều đủ.
- **Nguyên nhân**: hàm `radarRow` trong `lib/model.ts` không đưa trường
  `farm_steps` vào `RadarRow`, nên `rows` trong `out/data.js` (nguồn dữ
  liệu duy nhất của dashboard) thiếu `farm_steps` ở cả 226 dòng.
  `out/board.json` không bị ảnh hưởng (vẫn đủ 226 `farm_steps`) và gate
  `farm_steps` đọc `board.json` nên đã pass từ Phase 1 — lỗ hổng chỉ lộ
  khi xem panel detail trong ảnh.
- **Cách sửa**: thêm đúng **4 dòng** vào `lib/model.ts`: 2 dòng đưa
  `farm_steps` vào `RadarRow` (interface + gán `row.farm_steps` trong
  `radarRow`), 2 dòng còn lại là khoá `watchlist` (đã ghi ở 6.4). **Không
  đổi công thức, không đổi số liệu**, không sửa `main.ts`.
- **Kiểm chứng**:
  - `out/data.js`: **226 lần** `farm_steps` (đủ 226 dòng).
  - `out/board.json`: **trùng byte** với commit `30273f1` (md5
    `0c92f684…`, `git diff` trống) → mọi implied giữ nguyên (Steakhouse
    vẫn **1,094,803,096**).
  - Gate chạy lại: **8/8 PASS**.
  - 3 ảnh **chụp lại 17/11 ~12:22** (bảng 6.3): `2-detail.png` hiện đủ
    **7 farm steps** của Steakhouse; `3-filtered.png` hiện đủ tiêu đề +
    stats (33/33 Risk Curators); `1-board.png` không đổi.
