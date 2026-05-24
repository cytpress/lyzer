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

CLOUDFLARE_PAGES_PROJECT_NAME=你的 Cloudflare Pages project name
CLOUDFLARE_API_TOKEN=你的 Cloudflare API token
CLOUDFLARE_ACCOUNT_ID=你的 Cloudflare account id
```

`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 是 wrangler deploy 需要的認證資訊。

## 4. Compose 安全與埠口避讓設定

GL552VW 伺服器上的 `3000` 埠口已被 **Dockhand** 面板佔用。為了防範衝突，我們在 [docker-compose.yml](file:///c:/Users/Administrator/Desktop/ly/lyzer/docker-compose.yml) 中將外部對外埠口安全改為 **`3020`**。

Postgres 絕對不應公開到 Internet，**必須僅在 Tailscale / 私有 VPN 內網或主機防火牆嚴格保護下外露**，以防範資安風險。在安全的內網通道中，我們對開發團隊外露 `5432` 埠口以供 Beekeeper 桌面客戶端直連審查與維修。

API 埠口避讓對應：

```yaml
ports:
  - "3020:3000" # GL552VW 的 3020 埠口映射到容器內部的 3000
```

目前所有的背景任務端點已被重構為私有且安全一致的 **`/jobs`** 命名空間（例如 `/jobs/fetch` 等），不再使用舊的 `/admin/jobs` 或 `/internal`。

您可以在瀏覽器造訪以下網址，直接打開高顏值的 Scalar API 互動控制台（免敲 CLI 指令，點網頁按鈕即可背景執行）：
👉 **`http://{伺服器IP}:3020/lyzer-console`**

## 5. Dockhand Git Stack

建立 Git stack：

```text
Stack name: lyzer
Repository: cytpress/lyzer
Branch: v2
Compose file path: docker-compose.yml
Context directory: .
Environment / Node: GL552VW
```

Deploy options：

```text
Build images on deploy: ON
Disable build cache: OFF
Re-pull images: optional
Force redeployment: OFF
```

因為 `api` 使用 Dockerfile build，`Build images on deploy` 必須打開。

## 6. Dockhand Env / Secrets

為了防範在**公開的 Git Repository** 中外洩密碼，本專案的 `docker-compose.yml` 已全面改用 **Environment Interpolation (環境變數動態注入)**，無任何明文密碼被 hardcode 在程式庫中。

請在 Dockhand Stack 控制面板的 Environment 中設定：

建議標成 secret：

```bash
GEMINI_API_KEY
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
POSTGRES_PASSWORD                # 資料庫安全密碼 (例如：SecureDbPassword123)
```

一般變數：

```bash
POSTGRES_USER                    # 資料庫帳號 (選填，預設：lyzer_admin)
POSTGRES_DB                      # 資料庫名稱 (選填，預設：lyzer_db)
LYAPI_BASE_URL
LYAPI_GAZETTE_LIMIT
LYAPI_AGENDA_LIMIT
GEMINI_MODEL_NAME
ANALYZE_BATCH_SIZE
SSG_API_BASE
CLOUDFLARE_PAGES_PROJECT_NAME
```

Dockhand 在部署時會自動將這些環境變數注入 `docker-compose.yml`。這樣您的公開 GitHub 儲存庫將 100% 安全無虞，無任何洩密風險。

## 7. 部署後檢查

當容器成功啟動後，我們可以透過健康檢查來確認 API 的健康狀態：

如果 API 綁 Tailscale IP 且使用映射埠口 `3020`：

```bash
curl http://GL552VW_TAILSCALE_IP:3020/health
```

或是直接在瀏覽器開啟高顏值的 Scalar API 互動控制台（免敲指令，點點滑鼠即可測試）：
👉 **`http://GL552VW_TAILSCALE_IP:3020/lyzer-console`**

---

## 8. 第一次上線流程 (免指令，100% 網頁操作)

第一次部署 stack 後，不推薦進行全自動流水線。建議在 **`http://{伺服器IP}:3020/lyzer-console`** 頁面上，依序手動觸發測試：

1.  **確保 API 與 DB 順暢啟動**：確認訪問 `http://{伺服器IP}:3020/health` 回傳 `{"ok":true}`。
2.  **單筆 fetch 測試 (資料抓取)**：
    在 `/jobs/fetch` 的 Request Body 中輸入：
    ```json
    {
      "pages": 1,
      "startPage": 1
    }
    ```
    點擊 `Send Request` 執行，並使用 **Beekeeper Studio** 直連資料庫（埠口 `5432`），人工確認 `gazettes` 與 `agendas` 表是否有成功寫入公報發言。
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
