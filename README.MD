# lyzer

### 這個專案是甚麼？

LYZER 是一個開源專案，旨在利用大型語言模型，自動化分析並摘要立法院公報內容，讓一般民眾能更快速地理解立法院委員會的實質討論過程。

---

### 資料流

lyzer 的自動化資料流設計如下：

```text
LYAPI -> API fetch job -> PostgreSQL
PostgreSQL pending rows -> API analyze job -> Gemini -> analysis_results
completed analysis rows -> API SSG endpoints -> Cloudflare Pages build
browser -> Cloudflare Pages static site
```

1. 抓取：定期從 LYAPI 增量抓取最新公報與議程寫入 PostgreSQL。
2. 分析：定期撈取待處理的議程，呼叫 Gemini 生成 AI 摘要與結構化大綱。
3. 編譯與部署：當有新分析完成時，自動戳 Cloudflare Pages 部署 hook，由 Pages 雲端拉取資料進行 Astro 靜態編譯（SSG），確保公開網站在我自己 server 掛掉出事時還能運作。

Ubuntu 主機以 Docker Compose 執行 PostgreSQL、API、排程器與 Cloudflare Tunnel，並由 Dockhand 管理 Lyzer stack；網站則由 Cloudflare Pages 透過 Git 整合發布。

---

### 特別感謝

- 特別感謝歐噴有限公司 OpenFun Ltd.。
- 本專案的 API 與資料來源為 [OpenFun Ltd. LYAPI](https://ly.govapi.tw/)，並依 CC BY 4.0 授權條款使用。

---

### 授權條款

本專案採用 [MIT License](LICENSE) 授權釋出。
