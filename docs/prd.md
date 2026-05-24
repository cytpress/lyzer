# lyzer v2 PRD

更新日期：2026-05-24

## 目標

lyzer v2 將立法院公報議程整理成可搜尋、可收藏、可連回原始資料與 Lawtrace 的靜態網站。

核心設計是：

- `packages/api`：Hono + Node.js + PostgreSQL，跑在 GL552VW，提供 private API 與 jobs。
- `packages/web`：Astro SSG，輸出靜態網站並部署到 Cloudflare Pages。
- 資料來源：`https://ly.govapi.tw/v2`。
- AI 摘要：Gemini 3 Flash。
- 存取模型：後端 API 不公開到 Internet，預期透過 Tailscale 連線。

公開網站必須在 GL552VW API 停止時仍可瀏覽，因為 Cloudflare Pages 只吃靜態輸出。

## 使用者價值

- 快速理解委員會議事紀錄的核心脈絡。
- 搜尋議題、法案、委員、官員與摘要內容。
- 收藏重要議程。
- 從 lyzer 回到原始公報、PDF、文字資料。
- 從 lyzer 連到 Lawtrace，查看相關法案或法律修正脈絡。

## 現役架構

```text
LYAPI -> Hono fetch job -> PostgreSQL
PostgreSQL pending rows -> Hono analyze job -> Gemini 3 Flash -> analysis_results
PostgreSQL completed rows -> Astro build -> Cloudflare Pages
Browser -> static HTML / search-index.json / localStorage bookmarks
```

## 主要資料模型

目前已落地：

```text
gazettes
  gazette_id text primary key
  volume integer
  issue integer
  booklet integer
  publish_date date
  raw jsonb
  fetched_at timestamptz

agendas
  agenda_id text primary key
  gazette_id text references gazettes(gazette_id)
  meeting_dates date[]
  subject text
  category_code integer
  parsed_url text
  txt_url text
  official_page_url text
  official_pdf_url text
  raw jsonb
  fetched_at timestamptz

analysis_results
  agenda_id text primary key references agendas(agenda_id)
  status text
  analysis_json jsonb
  analyzed_at timestamptz
  error_message text
  updated_at timestamptz
```

下一階段要落地：

```text
agenda_bills
  agenda_id
  bill_no
  bill_name
  source
  raw

agenda_meetings
  agenda_id
  meet_id
  meeting_name
  raw
```

`agenda_speakers`、IVOD clip、speech clips 可以後續再拆。第一輪 bill/law mapping 先讓 lyzer 能可靠連到 Lawtrace。

## LYAPI 對接

已使用：

- `GET /gazettes`
- `GET /gazettes/{gazette_id}/agendas`
- agenda raw 中的 `處理後公報網址`
- agenda raw 中的 `parsed` 與 `txt` 文件 URL

待做 mapping：

- 優先研究 `/meets` 與 `/meets/{id}` 中的 `議事網資料.關係文書.議案`
- 必要時用 `/bills/{billNo}/meets` 輔助回推
- `/meets/{id}/bills` 可做參考，但先不要假設它一定最可靠

## Lawtrace Mapping

方向：lyzer 以 `agenda_id` 作為 canonical detail route，因此不需要舊版 `find-by-agenda-id` 轉址。

```text
/gazettes/{agenda_id}
```

lyzer -> Lawtrace：

1. 從 agenda / meet 關係找到相關 bill numbers。
2. 寫入 `agenda_bills`。
3. 詳細頁顯示「查看 Lawtrace 法案比對」連結。

Lawtrace -> lyzer：

Lawtrace 如果已有 `agenda_id`，可直接連：

```text
https://{lyzer-site}/gazettes/{agenda_id}
```

## AI 分析

使用 Gemini 3 Flash，預設 model id：

```text
gemini-3-flash-preview
```

輸出欄位維持舊版主要 shape：

- `summary_title`
- `overall_summary_sentence`
- `committee_name`
- `agenda_items`
  - `item_title`
  - `core_issue`
  - `controversy`
  - `legislator_speakers`
  - `respondent_speakers`
  - `result_status_next`

分析只處理 `category_code = 3` 的委員會紀錄。

## 前端需求

首頁：

- 顯示 completed analysis list。
- 委員會 filter。
- 搜尋議題、法案、委員、官員、摘要。
- 日期排序與相關性排序。
- localStorage 收藏。

詳細頁：

- 使用 `/gazettes/{agenda_id}`。
- 顯示摘要標題、總摘要、委員會、會議日期、公報資訊。
- 顯示核心問題、爭議、立委發言、答詢與回應、結果與後續。
- 顯示原始資料連結。
- 加入舊版風格 TOC：桌面右側、手機抽屜、hash deep link、IntersectionObserver active state。
- 顯示 Lawtrace 連結，當 `agenda_bills` 有資料時出現。

收藏頁：

- 使用 `lyzer-bookmarks` localStorage key。
- 靜態網站環境下不呼叫後端。

## 後端 API

目前 endpoint 已經重構為精簡且一致的私有命名空間 `/jobs/...`，不需 CLI 即可透過 Scalar 控制台遠端觸發：

- `GET /health`
- `POST /jobs/fetch`
- `POST /jobs/analyze`
- `POST /jobs/build`
- `POST /jobs/deploy`
- `GET /api/ssg/homepage`
- `GET /api/ssg/agenda-ids`
- `GET /api/ssg/agendas/:agenda_id`
- `GET /api/ssg/committees`
- `GET /api/ssg/legislators` (立委發言與時間軸已在後端直接聚合，Astro 編譯期僅需 1 次 API 請求，極致高效優化)

API 只預期在 Tailscale / LAN / localhost 使用，不公開到 Internet。

## 暫緩事項

以下不是 v2 第一輪阻塞項：

- `find-by-agenda-id` 轉址。
- `job_state` 增量游標。
- analysis attempts。
- stuck processing rescue。
- RAG / embeddings / pgvector。
- **完整立委個人資料庫 (如政黨、履歷等) 仍暫緩** (已先做由 AI analysis_json 派生的立委發言頁；完整立委資料庫仍暫緩)。
- IVOD clip 精準跳轉。

這些之後可以加，尤其 attempts/rescue 若長時間 jobs 實測仍需要再補。
