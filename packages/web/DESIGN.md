# Lyzer 介面規則

Lyzer 是公共資訊閱讀工具。標題、日期、委員會與摘要應是視覺重點；互動和裝飾保持克制。

## 技術與元件

- Astro 產生靜態頁面。首頁搜尋與結果卡片由 `HomeSearch.svelte` 和 `AgendaCard.svelte` 同時負責初次輸出與瀏覽器互動，避免維護兩份卡片 HTML。
- 詳細頁的內容、目錄與來源資訊由 `src/components/gazette/` 的 Astro 元件組成。
- `src/scripts/site.ts` 在 Astro 頁面切換後初始化頁首搜尋和詳細頁目錄。頁首搜尋透過 `lyzer:header-search` 事件通知首頁元件。
- 跨元件共用且較長的 Tailwind class 組合放在 `src/lib/styles.ts`。元件內的長 class 以 `class:list`（Astro）或 class 陣列（Svelte）按版面、色彩、互動狀態分組。

## 樣式分工

- `src/styles/global.css` 是唯一的全域入口：匯入 Tailwind、宣告自託管 Noto Sans TC、設計 token、HTML 基礎行為、鍵盤焦點、跨頁 `.page-shell` 和目錄展開動畫。
- 捲軸使用標準的 `scrollbar-color` 與 `scrollbar-width`；不再維護瀏覽器專屬的捲軸偽元素。
- 元件能直接控制的標題、段落、清單與卡片，使用元件上的 Tailwind utilities。不要為這類內容新增 `.detail-section h2` 式的全域後代選擇器。
- `.page-shell` 保持最大 1024px 寬度；小螢幕左右留白 16px，768px 以上左右留白 32px。
- `.toc-children` 的展開高度由 JavaScript 依內容設定，因此保留 CSS 的 `max-height` 過渡效果。
- 使用 `data-*` 表達互動狀態，並由 Tailwind 的 `data-[...]` 變體處理顏色與邊框。

## 視覺與可用性

- 正文以 16px 和約 1.85 行高閱讀；字重主要使用 400、500、600。底色為淺灰，閱讀內容與卡片為白色。
- 互動元件至少 40px 高，鍵盤焦點要可見，動畫遵守 `prefers-reduced-motion`。
- 動態搜尋保留可閱讀的初始十筆卡片；完整目錄和搜尋索引只在需要時下載。

## 搜尋與索引

- Astro 建置時產生分段的目錄與 MiniSearch 索引。首頁依查詢、委員會及排序顯示結果。
- 公報詳細頁與公開一般頁面列入 sitemap；立委頁維持 `noindex`。`robots.txt` 指向 sitemap。
