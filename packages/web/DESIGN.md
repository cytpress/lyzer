# Lyzer 介面規則

Lyzer 是公共資訊閱讀工具。介面保持中性、安靜，讓標題、日期、委員會與摘要成為視覺重點。

## 基礎規則

- 字型使用自託管 Noto Sans TC，正文 16px、行高約 1.8，粗細以 400、500、600 為主。
- 頁面底色為 `neutral-50`，閱讀內容與卡片使用白色；主文字用 `neutral-900`，輔助資訊用 `neutral-600`。
- 桌面內容上限 1280px，長文上限約 768px。
- 互動元件至少 40px 高，鍵盤焦點使用可見外框，動畫遵守 `prefers-reduced-motion`。

## 共用樣式

共用 token 與元件 class 集中在 `src/styles/global.css`：

- `page-shell`、`page-shell-narrow`：頁面寬度與左右留白。
- `agenda-card`：首頁與收藏頁的議程摘要卡。
- `filter-chip`：委員會篩選與其他單選條件。
- `committee-tag`：依委員會使用固定、低彩度的識別色。
- `icon-button`：收藏等只有圖示的操作。

頁面可以使用 Tailwind 處理單次排版；跨頁重複的視覺規則應回到上述共用 class。
