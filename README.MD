# LYZER 立法院公報摘要

## ⚠️ 重要提醒：後端 Supabase 的 Edge Functions 皆為 Vibe Coding ⚠️

我僅提出需求、告知資料流動邏輯、進行測試與整合確保能夠運作。

## 這個專案是甚麼？

**LYZER** 是一個開源專案，旨在利用大型語言模型（AI）自動化分析並摘要立法院公報內容，讓一般民眾能更輕鬆、快速地理解委員會的實質討論過程。

➡️ **線上瀏覽：[https://ly-gazette.vercel.app/](https://ly-gazette.vercel.app/)**

![專案預覽圖](https://raw.githubusercontent.com/cytpress/ly-gazette/main/demo.gif)

## 專案緣起與目標

立法院的委員會是國家政策與法案被實質形塑的關鍵場域。而立法院公報篇幅冗長繁雜，對一般民眾而言存在極高的閱讀門檻。

本專案目標是降低閱讀門檻，提供使用者更容易閱讀與理解摘要內容，並透過以下三點達成：

1.  **自動化**：每日自動抓取最新的立法院公報資料。
2.  **AI 摘要**：利用 Google Gemini AI 模型，將數萬字的會議記錄精煉成結構化的摘要，包括核心議題、爭議點、各方發言和會議後續發展。
3.  **易用性**：提供一個現代化、響應式且易於搜尋和篩選的網站介面，讓任何人都能快速找到並理解感興趣的會議內容。

## 技術架構

以 Supabase 作為後端核心，整合 Google Gemini 進行 AI 分析公報內容。

![架構預覽圖](https://raw.githubusercontent.com/cytpress/ly-gazette/main/structure.png)

### Backend - Supabase

- **Database**: 使用 PostgreSQL 儲存公報、議程及 AI 分析結果，並利用 View 簡化前端查詢。
- **Edge Functions**: 使用 Deno (TypeScript) 編寫，處理所有後端邏輯：
  - `fetch-new-gazettes`: 於 Supabase 設定 Cron Job，從[LYAPI](https://ly.govapi.tw/v2/)抓取新公報，並將待分析內容存入資料庫。
  - `analyze-pending-agendas`: 於 Supabase 設定 Cron Job，讀取待分析內容，呼叫 Gemini AI 進行分析，並將結構化 JSON 結果寫回資料庫。
  - `rescue-stuck-analyses`: 輔助任務，自動處理因意外中斷、或因 Supabase 平台限制而卡在「處理中(processing)」狀態的任務，確保系統能持續運作。
- **Full-text search**: 採用 [**PGroonga**](https://pgroonga.github.io/) 擴充套件，對 `analysis_result` (JSONB) 欄位建立全文搜尋索引，提供比內建功能更佳的中文斷詞與相關性排序。

### Frontend

- **Framework**: React (with Vite)
- **Language**: TypeScript
- **CSS framework**: Tailwind CSS
- **Data Fetching & State Management**:
  - `@tanstack/react-query`: 處理首頁和詳細頁面與後端 API 的交互。
  - `React Context API`: 管理全域的搜尋和篩選狀態。
- **Routing**: `react-router-dom`

## 未來展望

- [ ] **書籤功能**：允許使用者將摘要保存到 `localStorage` 中。
- [ ] **同義詞搜尋**：整合法律詞彙別名，讓搜尋結果更智慧（例如搜尋「勞基法」也能找到「勞動基準法」的結果）。
- [ ] **對話式閱讀模式**：建立以對話問答發言氣泡形式的新 UI。
- [ ] **立法委員資料庫**：建立立法委員的個人頁面，展示其出席會議和發言連結。

## 授權

本專案採用 [MIT License](https://github.com/cytpress/ly-gazette/blob/main/LICENSE) 授權。所有原始碼皆可自由使用。

API 與資料來源為 [OpenFun Ltd. LYAPI](https://ly.govapi.tw/v2/)，並依 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh-hant) 授權使用。

```

```
