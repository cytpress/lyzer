# lyzer v2 後續 TODO 與人工檢查清單

這份文件是 v2 migration push 之後的收斂清單。目標是先確認「舊版功能與體驗完整搬家」，再開始接真實資料、部署與未來擴充。

## 目前狀態

- 分支：`v2`
- 專案名稱：`lyzer`
- 架構：root pnpm workspace，`packages/api` + `packages/web`
- 後端：Hono + Postgres，私有 API / CLI job
- 前端：Astro SSG + Tailwind v4 + vanilla JS
- 搜尋：MiniSearch + CJK bigram + alias 字典
- 分析：已恢復舊版 Gemini prompt/schema 的主要欄位形狀
- 已知驗證：
  - `pnpm typecheck` 通過
  - Astro build 用空資料 SSG stub 產生過靜態檔案
- 尚未完整驗證：
  - 真實 Hono SSG API + 真實 DB build
  - 真實 LYAPI fetch
  - 真實 Gemini analyze
  - 真實 Cloudflare Pages direct upload

## Push 前檢查

- 確認 `.env.example` 有推，且沒有任何真實 secret。
- 確認以下檔案不要推，除非刻意要版本化：
  - `.agents/`
  - `skills-lock.json`
  - `lyapi-swagger.yaml`
- 確認 `.gitignore` 已排除：
  - `.env`
  - `.env.*`
  - `node_modules/`
  - `dist/`
  - `build/`
  - `.astro/`
  - `packages/*/dist/`
  - `packages/web/.astro/`
- 確認大量刪除的舊檔案符合預期：
  - `backend/`
  - `frontend/lygazsum/`
  - 舊 Supabase functions / migrations
  - 舊 React/Vite frontend
- 確認 Vercel 已設定只 build production，避免 `v2` preview build 亂跑。

建議 push 前執行：

```bash
git status
git diff --stat
git diff --cached --stat
pnpm typecheck
```

## 第一階段：讓真實資料跑通

- 準備本機 `.env`。
  - `DATABASE_URL`
  - `GEMINI_API_KEY`
  - `GEMINI_MODEL_NAME`
  - `LYAPI_BASE_URL`
  - `SSG_API_BASE`
  - Cloudflare deploy 相關環境變數
- 啟動 Postgres。
- 跑 DB schema 初始化。
  - 確認 `gazettes`
  - 確認 `agendas`
  - 確認 `analysis_results`
- 跑少量 fetch。
  - 確認 `/gazettes` 可抓。
  - 確認 `/gazettes/{gazette_id}/agendas` 可抓。
  - 確認中文 key 只在 `lyapiClient` adapter 層處理。
  - 確認 `agenda_id` 穩定、沒有重複。
  - 確認 `parsed_url` / `txt_url` 有正確存入。
- 人工抽查 DB。
  - `gazettes.raw` 是否保留 LYAPI 原始 json。
  - `agendas.raw` 是否保留 LYAPI 原始 json。
  - `category_code = 3` 是否真的是委員會紀錄。
  - `meeting_dates` 是否正確。
  - `subject` 是否可讀。

## 第二階段：分析流程驗證

- 先只分析 1-3 筆，不要一開始批次全跑。
- 確認 `analyzePendingAgendas()` 只處理 `category_code = 3`。
- 確認狀態流轉：
  - 無 row / `pending`
  - `processing`
  - `completed`
  - `failed`
- 確認 parsed JSON 抓取失敗時會 fallback `txt_url`。
- 確認 Gemini 回傳 JSON 可被寫入 `analysis_results.analysis_json`。
- 人工檢查分析品質：
  - `summary_title` 是否像舊版一樣短而準。
  - `overall_summary_sentence` 是否約 100-150 字。
  - `committee_name` 是否是陣列，例如 `["社會福利及衛生環境委員會"]`。
  - `agenda_items[].item_title` 是否是實質議程，不要只寫程序。
  - `core_issue` 是否有保留背景與問題脈絡。
  - `controversy` 是否有呈現分歧理由，而不是只寫「有爭議」。
  - `legislator_speakers` 是否沒有黨籍，格式為 `姓名 立法委員`。
  - `respondent_speakers` 是否有職稱與單位。
  - `result_status_next` 是否排除單純程序性宣告。
  - 數字是否用阿拉伯數字。
- 人工比對舊版 prompt 產物。
  - 找 1 篇舊版已分析的公報與 v2 結果對照。
  - 確認欄位形狀與頁面呈現沒有漏掉舊版重要資訊。

## 第三階段：SSG build 驗證

- 啟動 Hono API。
- 設定 `SSG_API_BASE` 指向 Hono private endpoint。
- 跑：

```bash
pnpm --filter @lyzer/web build
```

- 確認產出：
  - `packages/web/dist/index.html`
  - `packages/web/dist/search-index.json`
  - `packages/web/dist/bookmarks/index.html`
  - `packages/web/dist/about/index.html`
  - `packages/web/dist/gazettes/{agenda_id}/index.html`
- 人工打開靜態頁檢查：
  - 首頁清單是否依日期新到舊。
  - 卡片樣式是否接近舊版。
  - 委員會 filter 是否可用。
  - 搜尋是否可用。
  - 搜尋 `勞基法` 是否能命中 `勞動基準法`。
  - 收藏是否存在 localStorage。
  - 詳細頁是否正確顯示議程、核心問題、爭議、發言者、結果與原始連結。
  - 手機版文字是否不溢出、不重疊。

## 第四階段：舊版體驗人工驗收

- 首頁：
  - 視覺密度是否接近舊 React 版。
  - Tailwind 樣式是否有生效。
  - 卡片 hover、圓角、間距是否舒服。
  - header 搜尋是否直覺。
  - mobile 搜尋是否可用。
- 詳細頁：
  - 摘要標題是否醒目。
  - metadata 是否完整。
  - 發言者列表是否容易掃讀。
  - 每個議程區塊是否不會太長或太碎。
  - 原始資料連結是否存在且可點。
- 收藏頁：
  - 收藏/取消收藏是否即時更新。
  - 重整後 localStorage 是否保留。
  - 空狀態是否正常。
- 搜尋：
  - 中文 bigram 是否有提高 recall。
  - alias 是否正常。
  - 排序與 filter 疊加是否符合直覺。
  - 沒結果時是否清楚。

## 第五階段：部署到 GL552VW + Cloudflare Pages

- 在 GL552VW 上準備 runtime。
  - Node / pnpm
  - Docker / Docker Compose
  - Postgres volume
  - `.env`
- 啟動長駐服務：
  - `postgres`
  - `api`
- 確認 Hono private API：
  - `GET /health`
  - `POST /admin/jobs/fetch`
  - `POST /admin/jobs/analyze`
  - `POST /admin/jobs/build`
  - `POST /admin/jobs/deploy`
  - `POST /admin/jobs/daily`
- 跑一次完整 pipeline：

```bash
pnpm job:fetch
pnpm job:analyze
pnpm job:build
pnpm job:deploy
```

- 確認 Cloudflare Pages direct upload 成功。
- 確認公開網站在 GL552VW API 停掉時仍可瀏覽。
- 設定 systemd timer 或 host cron。
- 確認 daily job 不會重複抓資料、不會重複分析 completed row。

## 需要修改或再決策的事項

- README 需要補完整使用方式。
  - local dev
  - env vars
  - DB setup
  - fetch/analyze/build/deploy jobs
  - GL552VW deploy
- 是否需要保留 `docs/migration-archive.md`。
  - 若只是歷史討論整理，可以保留。
  - 若內容太舊或太長，後續可再壓縮成 ADR。
- 是否要把 `lyapi-swagger.yaml` 放進 repo。
  - 目前不建議。
  - 若要保留，建議移到 `docs/reference/lyapi-swagger.yaml` 並註明更新日期。
- 是否要恢復舊版 logo SVG。
  - 目前 header 使用文字 `lyzer`。
  - 若要 1:1 舊視覺，可把舊 SVG 搬到 `packages/web/src/assets/`。
- 是否要恢復舊版 footer / about copy。
  - 目前是 v2 簡化文字。
- 是否要把搜尋 UI 做得更像舊版 SearchOverlay。
  - 目前是 header + mobile input + MiniSearch。
- 是否要把詳細頁做 TOC。
  - 目前未恢復舊版 Table of Contents。
- 是否要加入錯誤頁 / loading skeleton。
  - SSG v1 可先不用，但之後可補。
- 是否要加入 E2E 測試。
  - 建議等真實資料跑通後再補 Playwright。

## 不要現在做的事

- 不做 RAG。
- 不做 embedding / pgvector。
- 不做 `document_blocks`。
- 不做立委資料庫拆表。
- 不做法案 mapping UI。
- 不做 prompt version / model name / input hash。
- 不搬 Supabase completed data。

## 後續可擴充但目前保留的線索

- `agendas.agenda_id`
- `agendas.raw`
- `agendas.parsed_url`
- `analysis_results.analysis_json`

未來如果要做：

- 立委資料庫：從 `parsed_url` 回抓內容再 backfill。
- 初代 RAG：先從 `analysis_json` 產生 embedding text。
- 會議討論法案：從 LYAPI `/meets` 或 `/bills/{billNo}/meets` 回補 mapping。

## 建議優先順序

1. 清 staging，確認不該 push 的檔案已 unstage。
2. push `v2` 當 WIP branch。
3. 補 README。
4. 用真實 DB 跑少量 fetch。
5. 用真實 Gemini 分析 1-3 筆。
6. 用真實 Hono SSG API build。
7. 人工檢查首頁與詳細頁。
8. 修樣式與分析欄位落差。
9. 再跑完整 pipeline。
10. 接 Cloudflare Pages direct upload。
