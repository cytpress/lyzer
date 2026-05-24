# lyzer v1 Feature Parity

這份文件給 AI agent 與開發者快速理解舊版功能如何運作。它不是 v2 架構真相來源；v2 架構請看 `prd.md`。

## 舊版架構

```text
React SPA
Supabase PostgREST
Supabase Edge Functions
PostgreSQL views / RPC
PGroonga search
localStorage bookmarks
```

主要路由：

```text
/
/detailedGazette/{analyzed_content_id}
/bookmarks
/about
```

v2 路由改為：

```text
/
/gazettes/{agenda_id}
/bookmarks
/about
```

## 舊版資料流程

### Fetch

舊版 `fetch-new-gazettes`：

1. 從 `job_state` 取得上次處理的公報 ID。
2. 抓 `/v2/gazettes`。
3. 對每個新公報抓 `/v2/gazettes/{gazette_id}/agendas`。
4. 寫入 `gazettes`、`gazette_agendas`。
5. 對 `category_code = 3` 的 agenda 建立 pending analysis。

v2 短期不搬 `job_state`，因為不再受 Supabase Edge Function 執行時間限制。

### Analyze

舊版 `analyze-pending-agendas`：

1. 撈 pending / retryable failed items。
2. 標成 processing。
3. 檢查 category，只分析 `category_code = 3`。
4. 抓公報文字。
5. 呼叫 Gemini。
6. 寫入 structured JSON。
7. 失敗時記錄 error type、attempt count。

v2 保留主要 prompt/schema shape，但 attempts/rescue 先不做。

### Rescue

舊版有 `rescue-stuck-analyses`，用來把長時間 processing 的 item 退回 pending 或 failed。

v2 暫緩。若未來 jobs 仍會卡住，再加回。

### find-by-agenda-id

舊版用 `agenda_id` 查 `analyzed_content_id`，再 302 到 `/detailedGazette/{uuid}`。

v2 不需要。`agenda_id` 已是 canonical URL。

## 舊版首頁功能

首頁使用 Supabase views / RPC：

- 無搜尋時讀 `vw_homepage_gazette_items`。
- 有搜尋時呼叫 `search_analyzed_contents` RPC。
- 可依委員會 filter。
- 搜尋結果有 relevance score 與 highlight。
- 有分頁。
- 有排序：
  - relevance desc
  - relevance asc
  - date desc
  - date asc
- 使用 React Query cache。
- 預抓常設委員會 filter 的第一頁資料。

v2 對應：

- Astro build 產生 `search-index.json`。
- MiniSearch 在瀏覽器端搜尋。
- CJK bigram tokenizer。
- alias expansion，例如 `勞基法 -> 勞動基準法`。
- local filtering / pagination / sorting。

## 舊版收藏

localStorage key：

```text
lyzer-bookmarks
```

舊版存的是 `analyzed_content_id`。

v2 存的是 `agenda_id`。

搬移時不保證舊收藏可直接相容，因為 ID 已換。

## 舊版詳細頁功能

舊版詳細頁顯示：

- `summary_title`
- `overall_summary_sentence`
- committee tags
- meeting date
- bookmark button
- agenda items
- metadata table
- desktop TOC
- mobile TOC drawer

每個 agenda item 顯示：

- 討論事項
- 核心議題
- 相關爭議
- 立法委員發言
- 相關人員發言
- 相關後續

## 舊版 TOC 規則

舊版 TOC 是詳細頁最重要的互動之一，v2 需要搬回。

Anchor id 規則：

```text
item-{itemIndex}-item-title
item-{itemIndex}-core-issues
item-{itemIndex}-controversies
item-{itemIndex}-legislators-speech
item-{itemIndex}-respondents-response
item-{itemIndex}-result-next
metadata-table
```

發言者子項：

```text
item-{itemIndex}-speaker-{slugified-speaker-name}
```

注意：舊版立法委員與相關人員都使用同一個 speaker id pattern。如果同一人在兩區都出現，可能造成 DOM id collision。v2 實作時建議加 group prefix：

```text
item-{itemIndex}-legislator-{slug}
item-{itemIndex}-respondent-{slug}
```

## 舊版 TOC 互動

- 使用 `IntersectionObserver`。
- root margin 約為 `-73px 0px -86% 0px`。
- 點擊 TOC link 時 smooth scroll。
- 點擊後用 `history.pushState` 更新 hash。
- 進入頁面時若 URL 有 hash，等待 DOM render 後 scroll。
- 立委發言 / 相關人員發言區塊進入 viewport 時，TOC 子項展開。
- 手機版 TOC 是右側抽屜。

## 舊版 metadata

舊版 metadata table 包含：

- 公報索引編號：卷 / 期 / 冊
- 所屬委員會
- 會議日期
- 原始案由
- 公報發布網址
- 公報發布日期
- 公報原始 PDF
- 章節所屬頁碼
- 章節 ID
- 公報 ID

v2 目前顯示其中一部分。若要完整 parity，需要補 start/end page 等欄位，或在 `agendas.raw` 中取出。

## 舊版錯誤與 loading

舊版 React 有：

- skeleton loading
- error display
- empty state
- retry

v2 是 SSG，runtime loading 較少，但仍需要：

- 空資料狀態。
- build-time API 失敗時的明確錯誤。
- 搜尋無結果狀態。

## Parity Checklist

- [ ] 首頁可搜尋。
- [ ] 首頁可 filter committee。
- [ ] 首頁可排序。
- [ ] 首頁可分頁。
- [ ] 收藏使用 `lyzer-bookmarks`。
- [ ] 收藏頁不依賴後端 runtime。
- [ ] 詳細頁顯示所有 agenda item sections。
- [ ] 詳細頁 TOC。
- [ ] TOC hash deep link。
- [ ] TOC active section highlight。
- [ ] TOC mobile drawer。
- [ ] 詳細頁 metadata。
- [ ] 原始資料連結。
- [ ] Lawtrace links。
