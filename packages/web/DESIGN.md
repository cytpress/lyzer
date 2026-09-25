# Lyzer 介面規則

Lyzer 是公共資訊閱讀工具。介面保持中性、安靜，讓標題、日期、委員會與摘要成為視覺重點。

## 基礎規則

- 字型使用自託管 Noto Sans TC，正文 16px、行高約 1.8，粗細以 400、500、600 為主。
- 頁面底色為 `neutral-50`，閱讀內容與卡片使用白色；主文字用 `neutral-900`，輔助資訊用 `neutral-600`。
- 所有頁面都使用同一個 `.page-shell`，最大寬度為 1024px；視窗小於 768px 時左右留白各 16px，768px 以上各 32px。
- 互動元件至少 40px 高，鍵盤焦點使用可見外框，動畫遵守 `prefers-reduced-motion`。

## 共用樣式

`src/styles/global.css` 是樣式入口，依序匯入 Tailwind 與分層樣式：

- `tokens.css`：字型、顏色與頁面寬度 token。
- `base.css`：HTML、body、表單控制項與鍵盤焦點的基礎樣式。
- `components.css`：共用頁面容器、卡片、篩選標籤與目錄元件。
- `responsive.css`：響應式規則與減少動態效果設定。

共用元件 class 包含：

- `page-shell`：所有頁面共用的寬度與左右留白。
- `agenda-card`：首頁議程摘要卡。
- `filter-chip`：委員會篩選與其他單選條件。
- `committee-tag`：依委員會使用固定、低彩度的識別色。
- `toc-close-button`：詳細頁目錄的關閉按鈕。

頁面可以使用 Tailwind 處理單次排版；跨頁重複的視覺規則應回到上述共用 class。

Astro 頁面互動入口位於 `src/scripts/site.ts`，首頁搜尋、頁首搜尋與詳細頁目錄分別放在同資料夾的獨立模組。

## 搜尋引擎

- Astro 建置會產生 `sitemap-index.xml`；公報詳細頁與公開一般頁面列入 sitemap，立委頁因為 `noindex` 而排除。
- 根目錄 `robots.txt` 指向 sitemap。正式網站部署後，在 Google Search Console 提交 `https://lyzer.tw/sitemap-index.xml`。
