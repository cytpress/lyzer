# lyzer v2 Roadmap

## P0：讓真實資料跑通

- 統一 Gemini 3 Flash model id。
- 確認 `.env.example` 與 `config.ts` 一致。
- 啟動 Postgres。
- 執行 `pnpm db:migrate`。
- 小量執行 `pnpm job:fetch`。
- 人工檢查 `gazettes`、`agendas`、`analysis_results`。
- 小量執行 `pnpm job:analyze`。
- 確認 Gemini 回傳 JSON 可寫入 `analysis_results.analysis_json`。
- 啟動 Hono API。
- 執行 Astro build，確認 SSG endpoints 可用。

## P1：舊版詳細頁體驗搬移

- 實作詳細頁 TOC。
- 產生穩定 anchor id。
- 支援 hash deep link。
- 支援 IntersectionObserver active state。
- 支援手機 TOC 抽屜。
- TOC 應包含：
  - 討論事項
  - 核心議題
  - 相關爭議
  - 立法委員發言
  - 相關人員發言
  - 相關後續
  - 原始資料
- 比對 `v1-feature-parity.md`，確認舊版詳細頁主要能力已保留。

## P1：Lawtrace / Bill Mapping

- 研究 `/meets`、`/meets/{id}`、`/bills/{billNo}/meets` 的實際資料品質。
- 決定 agenda -> meet -> bill 的 deterministic mapping 規則。
- 新增 `agenda_bills` schema。
- 視需要新增 `agenda_meetings` schema。
- 新增 mapping job。
- 詳細頁顯示 Lawtrace 連結。
- Lawtrace 若已有 `agenda_id`，直接連 `/gazettes/{agenda_id}`，不做 `find-by-agenda-id`。

## P1：API 命名收斂

- `[x]` **已完成：採 `/jobs/*`** (與私有 `/api/ssg/*`)；未來若要公開或加 auth 再改。

## P2：部署

- 更新 Docker Compose production settings。
- Postgres port 綁 localhost 或不公開。
- API port 綁 Tailscale IP 或 localhost。
- Dockhand stack deploy。
- Cloudflare Pages direct upload。
- 設定 host cron 或 systemd timer。
- 補 backup 策略。

## P2：可靠性增強

先不用做，但保留設計空間：

- `job_state` 增量游標。
- analysis attempts。
- stuck processing rescue。
- job lock。
- prompt version / model tracking。
- input hash。

目前暫緩理由：v2 後端在自己的 Node/Hono runtime 上跑，不再受 Supabase Edge Functions 短時間限制。

## P3：未來擴充

- IVOD clip / speech clip。
- **完整立委 Profile/履歷資料庫仍暫緩** (已先做由 AI analysis_json 派生的立委發言頁；完整立委資料庫仍暫緩)。
- RAG / embeddings。
- 法案進度看板。
- 站內關聯議題探索。
