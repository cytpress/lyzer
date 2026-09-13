# lyzer v2 部署教學

這份文件描述如何把 lyzer v2 部署到 GL552VW，並用 Dockhand 管理後端 stack。

v2 的部署原則：

- `packages/api` 長駐在 GL552VW，提供 Hono private API 與 CLI jobs。
- `postgres` 長駐在 GL552VW。
- `packages/web` 只在 build 時產生靜態檔，最後部署到 Cloudflare Pages。
- 公開網站不依賴 GL552VW runtime；GL552VW API 掛掉時，已部署的靜態頁仍可瀏覽。
- API 不公開到 Internet，預期透過 Tailscale / LAN / localhost 使用。

## 1. 本機檢查

```bash
pnpm install
pnpm typecheck
```

如果要測試前後端基本流程：

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm job:fetch
pnpm job:analyze
pnpm dev:api
```

另一個 shell：

```bash
pnpm --filter @lyzer/web build
```

注意：`job:analyze` 會打 Gemini API，第一次只跑少量資料。

## 2. GL552VW 前置需求

- Docker Engine
- Docker Compose plugin
- Dockhand
- Tailscale
- 能連到 GitHub repo
- 能連到 LYAPI
- 能連到 Gemini API
- 如果要 deploy Cloudflare Pages，需要 Cloudflare API token

Dockhand 具有 Docker 管理權限，應只放在 Tailscale / VPN / LAN 裡。

## 3. 環境變數

依 `.env.example`，至少需要：

```bash
# PostgreSQL 資料庫連接 (容器內部指向 postgres:5432)
DATABASE_URL=postgresql://lyzer_admin:SecureDbPassword123@postgres:5432/lyzer_db
PORT=3000 # 容器內部監聽埠口

LYAPI_BASE_URL=https://ly.govapi.tw/v2
LYAPI_GAZETTE_LIMIT=20
LYAPI_AGENDA_LIMIT=100

GEMINI_API_KEY=你的 Gemini API key
GEMINI_MODEL_NAME=gemini-3-flash-preview # 預設使用官方新一代 Gemini 3 Flash Preview (百萬超大上下文無損分析，100% 完整發言無損交付給 AI，已移除所有字數截斷邏輯)
ANALYZE_BATCH_SIZE=3

# 【重要備註】Astro 靜態編譯時對接後端的 API 位置。
# 容器內部編譯自動指向 http://127.0.0.1:3000；若是宿主機手動單獨編譯，必須指向避讓後的 http://127.0.0.1:3020
SSG_API_BASE=http://127.0.0.1:3020

# 部署至 Cloudflare Pages 的秘密 Webhook 網址，用於自動觸發雲端編譯
CLOUDFLARE_DEPLOY_HOOK_URL=你的 Cloudflare Pages deploy hook url
```

`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 是 wrangler deploy 需要的認證資訊。

## 4. Compose 安全與埠口避讓設定

GL552VW 伺服器上的 `3000` 埠口已被 **Dockhand** 面板佔用。為了防範衝突與外部未授權存取，我們在 [docker-compose.yml](file:///c:/Users/Administrator/Desktop/ly/lyzer/docker-compose.yml) 中將 API 對外埠口安全鎖定於本地迴路 `127.0.0.1:3020`，完全不暴露給外部網路。

Postgres 絕對不應公開到 Internet，**必須僅在 Tailscale / 私有 VPN 內網或主機防火牆嚴格保護下外露**，以防範資安風險。

API 埠口避讓對應：

```yaml
ports:
  - "127.0.0.1:3020:3000" # 將 3020 埠口安全鎖定在本地 127.0.0.1 迴路，僅限本地 Timer 與 Tunnel 存取
```

目前所有的背景任務端點已被重構為私有且安全一致的 **`/jobs`** 命名空間（例如 `/jobs/fetch` 等），不開放外網直接存取。

當您透過 **Cloudflare Zero Trust Access** 驗證登入後，可以在瀏覽器造訪以下網址，直接打開高顏值的 Scalar API 互動控制台：
👉 **`https://api.lyzer.tw/lyzer-console`**

## 5. Dockhand Git Stack

建立 Git stack：

```text
Stack name: lyzer
Repository: cyt如果 API 使用本地迴路 `3020`（可在主機上直接測試）：

```bash
curl -X GET http://127.0.0.1:3020/health
```

當您透過 **Cloudflare Zero Trust Access** 驗證登入後，可以直接在瀏覽器開啟高顏值的 Scalar API 互動控制台（點選網頁按鈕即可執行測試）：
👉 **`https://api.lyzer.tw/lyzer-console`**

---

## 8. 第一次上線流程 (免指令，100% 網頁操作)

第一次部署 stack 後，建議在 **`https://api.lyzer.tw/lyzer-console`** 頁面上，依序手動觸發測試：

1.  **確保 API 與 DB 順暢啟動**：確認訪問 `/health` 回傳 `{"ok":true}`。
2.  **單筆 fetch 測試 (資料抓取)**：
    在 `/jobs/fetch` 的 Request Body 中輸入：
    ```json
    {
      "pages": 1,
      "startPage": 1
    }
    ```
    點擊 `Send Request` 執行，確認 `gazettes` 與 `agendas` 表是否有成功寫入公報發言。
3.  **單筆 analyze 測試 (AI 大綱分析)**：
    在 `/jobs/analyze` 的 Request Body 中輸入：
    ```json
    {
      "limit": 1
    }
    ```
    點擊 `Send Request`。檢查是否成功調用 Gemini 生成摘要 JSON。
4.  **增量部署檢查測試**：
    在 `/jobs/deploy-check` 的 Request Body 中輸入：
    ```json
    {
      "dryRun": true
    }
    ```
    點擊 `Send Request`，確認回傳格式正確，顯示 `shouldDeploy: true`、`newCompletedAnalyses: 1` 且無任何報錯！

---

## 9. 系統自動化排程 (Systemd Timer & Service)

LYZER V2 採用高可用、無重疊且兼顧效能與資安的 **Systemd Timer** 來進行生產環境的自動化任務調度。

我們在 `ops/systemd/` 底下註冊了 3 對 Timer 與 Service 排程：

### A. 自動化排程列表與觸發時間
1.  **每日凌晨 02:00：`lyzer-fetch.timer`**
    * 呼叫 `POST /jobs/fetch` 增量抓取最新 3 頁公報。
2.  **每隔 5 分鐘：`lyzer-analyze.timer`**
    * 呼叫 `POST /jobs/analyze` 分析 1 筆掛起資料。
    * **🔒 Concurrency Protection**：腳本內置了 `flock` 檔案排他鎖（File Lock），當前一次分析尚未結束時，新一輪的定時器將會自動跳過（Safe Exit），絕對不會造成 API 額度超用或分析重疊！
3.  **每日凌晨 05:00：`lyzer-deploy-check.timer`**
    * 呼叫 `POST /jobs/deploy-check` 執行增量部署檢查。
    * **💡 智慧節流**：只有在「有新的 completed analysis」時，才會主動對 Cloudflare 發送 Deploy Hook 觸發雲端重建，否則自動跳過，不產生任何無意義的編譯負擔。

### B. 一鍵安裝與自動更新排程 (Production Installer & Updater)
我們在 `ops/` 底下維護了一支一鍵式排程管理器 **[install-systemd.sh](file:///c:/Users/Administrator/Desktop/ly/lyzer/ops/install-systemd.sh)**，它會自動為您處理所有權限設定、目錄建立、腳本複製與 systemd 重載，完美省去每次改動排程都要手動執行多條 `cp` 指令的困擾。

#### 1. 初次安裝或更新排程
每當您修改了 scripts 腳本、新增 timer、或是 Dockhand 更新了 git-repos 代碼後，請至本機 repo 目錄直接執行此一鍵管理腳本：
```bash
cd /var/lib/docker/volumes/dockhand_dockhand_data/_data/git-repos/local/lyzer
sudo ./ops/install-systemd.sh
```

這支指令會自動：
* 建立 `/home/cytpress/lyzer/scripts` 目錄並安全複製腳本。
* 設定所有 scripts 的執行權限 (`chmod 755`)。
* 將 systemd timer / service 配置安裝至 `/etc/systemd/system/`。
* **🔒 密鑰安全防護**：只有在 `/home/cytpress/lyzer/.env.scheduler` **不存在**時，才會從 `.env.scheduler.example` 複製範本；若該設定檔已存在，則只會確保其 `600` 安全唯讀權限，**絕對不會覆蓋您已在生產環境設定好的敏感金鑰**。
* 重載 systemd daemon 並立即啟用三個計時器 (`enable --now`)。

#### 2. 配置環境變數
如果是第一次安裝，請使用文字編輯器編輯排程環境變數，配置您的本地 API 位址與連線設定：
```bash
sudo nano /home/cytpress/lyzer/.env.scheduler
```
請確保填入正確的 `API_BASE`，預設為本機迴路：
```env
API_BASE=http://127.0.0.1:3020
FETCH_PAGES=3
ANALYZE_LIMIT=1
```

#### 3. 查看狀態與觀測日誌
* **文字終端機**：
  * 檢視所有排程：`systemctl list-timers 'lyzer-*'`
  * 觀測即時日誌：`journalctl -u lyzer-analyze.service -f --no-pager`
* **Cockpit 網頁控制台 (極力推薦！)**：
  * 登入您的 **Cockpit 控制台**。
  * 點選 **「Services (服務)」** ➔ 選擇 **「Timers (計時器)」** 標籤。
  * 在搜尋框輸入 `lyzer`，即可一目了然看見三個 Timer 的剩餘執行時間、上次執行時間、手動點擊執行（Run Now），以及查看完美的實時日誌！

---

## 10. Cloudflare Pages 雲端編譯 (SSG)

前端網頁完全託管在 **Cloudflare Pages** 平台，透過 **Git Integration** 直接與 GitHub 連動。

### 部署勾點 (Deploy Hook)
當後端 `/jobs/deploy-check` 判定需要更新網頁時，會直接在後端發送 POST 請求至您在 Cloudflare Pages 後台所建立的 **Deploy Hook 網址**。
這會自動讓 Cloudflare Pages 在雲端以最乾淨的環境拉取最新 v2 分支進行 SSG 編譯，不佔用您本機伺服器的任何 CPU/RAM 資源！

---

## 11. 常見問題

### API 連不到 Postgres� `Send Request` 執行，並使用 **Beekeeper Studio** 直連資料庫（埠口 `5432`），人工確認 `gazettes` 與 `agendas` 表是否有成功寫入公報發言。
3.  **單筆 analyze 測試 (AI 大綱分析)**：
    在 `/jobs/analyze` 的 Request Body 中輸入：
    ```json
    {
      "limit": 1
    }
    ```
    點擊 `Send Request`。檢查 `analysis_results` 表中是否有 Gemini 3 Flash Preview 所生成 100% 完整無損（無字元截斷）的 Markdown 摘要與結構化 TOC JSON。
4.  **前端 SSG 靜態編譯測試**：
    點擊 `/jobs/build` 的 `Send Request` 按鈕。
    - _💡 開發者提示_：在背景，Hono 會自動以 `SSG_API_BASE=http://127.0.0.1:3000` 連接容器內部運行中的埠口進行 Astro SSG 靜態頁面生成，這將順暢無比。
    - _⚠️ 踩坑提示_：如果您要在宿主機單獨手動執行本機編譯，請務必先宣告環境變數：`SSG_API_BASE=http://127.0.0.1:3020 pnpm build`。
5.  **前端靜態網頁發布**：
    點擊 `/jobs/deploy` 的 `Send Request` 按鈕，背景將會自動調用 Cloudflare Wrangler，將編譯好的頁面發布到您的 Cloudflare Pages 雲端。
6.  **最後驗證**：
    造訪您的 Cloudflare Pages 網站，點選右上角的 **「立委名冊」** 導航，驗證立委發言次數統計、個人時間軸以及發言重點跳轉功能是否流暢！

## 9. 排程 (Automation via Cron)

由於 LYZER V2 已全面轉型為以 API 為導向的系統，排程任務建議直接使用 GL552VW 主機上的 `cron` 配合 `curl` 定時呼叫後端 API：

```bash
# 每日凌晨 2 點：增量抓取最新公報
0 2 * * * curl -X POST http://127.0.0.1:3020/jobs/fetch -d '{"pages":3}' -H "Content-Type: application/json"

# 每日凌晨 3 點：觸發 AI 進行未分析公報大綱分析 (每次分析 5 筆)
0 3 * * * curl -X POST http://127.0.0.1:3020/jobs/analyze -d '{"limit":5}' -H "Content-Type: application/json"

# 每日凌晨 4 點：執行靜態網頁編譯與 Pages 自動發布
0 4 * * * curl -X POST http://127.0.0.1:3020/jobs/build && curl -X POST http://127.0.0.1:3020/jobs/deploy
```

## 10. Cloudflare Pages

deploy job 目前使用：

```bash
wrangler pages deploy packages/web/dist --project-name $CLOUDFLARE_PAGES_PROJECT_NAME
```

需要確認：

- `CLOUDFLARE_PAGES_PROJECT_NAME` 正確。
- `CLOUDFLARE_API_TOKEN` 有 Pages deploy 權限。
- `CLOUDFLARE_ACCOUNT_ID` 正確。
- Cloudflare Pages direct upload 狀態符合預期。

## 11. 常見問題

### API 連不到 Postgres

container 內的 DB host 應該是 compose service name：

```bash
postgres
```

不是 `localhost`。

### `job:build` 打不到 SSG API

如果 build 在 api container 內跑，`SSG_API_BASE=http://127.0.0.1:3000` 通常可以。

如果 build 在別的 container 或 host 跑，請改成實際可連的 host / service name，例如：

```bash
SSG_API_BASE=http://api:3000
```

### `job:deploy` wrangler 需要登入

container 裡不要做互動式 `wrangler login`。請使用：

```bash
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_PAGES_PROJECT_NAME
```

### Postgres 資料要保留

目前使用 named volume：

```yaml
volumes:
  postgres_data:
```

不要隨便 `docker compose down -v`。

## 12. 後續部署改善

- 把 Postgres password 改成 env secret。
- 移除或限制 Postgres exposed port。
- 限制 API port 只走 Tailscale / localhost。
- 補 API healthcheck。
- 補 scheduler container 或 systemd timer 範例。
- 補 Postgres backup 策略。
- 補 production compose override。
