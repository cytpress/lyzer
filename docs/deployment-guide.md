# lyzer v2 部署教學

這份教學描述如何把 lyzer v2 部署到 GL552VW，並用 Dockhand 管理後端 stack。v2 的設計是：

- `packages/api` 長駐在 GL552VW，提供 Hono private API 與 CLI jobs。
- `postgres` 長駐在 GL552VW。
- `packages/web` 只在 build 時產生靜態檔，最後部署到 Cloudflare Pages。
- 公開網站不依賴 GL552VW runtime；GL552VW API 掛掉時，已部署的靜態頁仍可瀏覽。

## 0. 推上 Git 前

建議先確認不要把本機或研究用檔案推上去：

```bash
git restore --staged .agents skills-lock.json lyapi-swagger.yaml
```

如果你想長期忽略它們，`.gitignore` 可加入：

```gitignore
.agents/
skills-lock.json
lyapi-swagger.yaml
```

`.env.example` 應該保留並推上去；它是部署文件的一部分，不應包含真實 secret。

## 1. 本機先做的檢查

在 Git Bash：

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

另一個 Git Bash：

```bash
pnpm --filter @lyzer/web build
```

注意：`job:analyze` 會打 Gemini API，先用少量資料測，不要一開始全跑。

## 2. GL552VW 前置需求

GL552VW 上需要：

- Docker Engine
- Docker Compose plugin
- Dockhand
- 能從 GL552VW 或 Dockhand 所在環境連到 GitHub repo
- 能連到 LYAPI
- 能連到 Gemini API
- 如果要 deploy Cloudflare Pages，需要 Cloudflare API token

建議 Dockhand 只放在 Tailscale / VPN / LAN 裡，不要直接公開到 internet。Dockhand 官方文件也提醒，它是 Docker 管理介面，具備很高權限，應該用 VPN、反向代理驗證或網路隔離保護。

## 3. 目前 compose 的重要提醒

目前 `docker-compose.yml` 是 v1 可跑的最小版本：

```yaml
services:
  postgres:
    image: postgres:16-alpine
  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
```

在正式放到 GL552VW 前，建議你檢查兩件事：

### 3.1 Postgres port 不應公開

目前 compose 有：

```yaml
ports:
  - "5432:5432"
```

如果只是 `api` container 連 `postgres`，其實可以移除 Postgres ports。若需要 host 本機除錯，也建議改成：

```yaml
ports:
  - "127.0.0.1:5432:5432"
```

### 3.2 API 只應 private 使用

目前 compose 有：

```yaml
ports:
  - "3000:3000"
```

如果 GL552VW 只有 Tailscale 可進，可以考慮綁 Tailscale IP，例如：

```yaml
ports:
  - "100.x.y.z:3000:3000"
```

或只在本機 reverse proxy 使用：

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

這個 API 包含 admin jobs，不應公開到 internet。

## 4. 需要準備的環境變數

依 `.env.example`，至少需要：

```bash
DATABASE_URL=postgresql://lyzer:lyzer@postgres:5432/lyzer
PORT=3000

LYAPI_BASE_URL=https://ly.govapi.tw/v2
LYAPI_GAZETTE_LIMIT=20
LYAPI_AGENDA_LIMIT=100

GEMINI_API_KEY=你的 Gemini API key
GEMINI_MODEL_NAME=gemini-2.5-flash
ANALYZE_BATCH_SIZE=3
MAX_ANALYSIS_CHARS=120000

SSG_API_BASE=http://127.0.0.1:3000

CLOUDFLARE_PAGES_PROJECT_NAME=你的 Cloudflare Pages project name
CLOUDFLARE_API_TOKEN=你的 Cloudflare API token
CLOUDFLARE_ACCOUNT_ID=你的 Cloudflare account id
```

其中 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 是 `wrangler pages deploy` 常見需要的認證資訊；目前程式只主動檢查 `CLOUDFLARE_PAGES_PROJECT_NAME`，但實際 deploy 時 wrangler 仍需要可用的 Cloudflare 認證。

## 5. 用 Dockhand 部署 lyzer stack

Dockhand 支援從 Git repository 部署 Docker Compose stack。官方文件的重點是：

- Git stack 會從 repo sync，然後執行 compose up。
- 設定時需要 repository、branch、compose file path、context directory。
- 如果 compose 有 `build:`，deploy options 裡要開啟 build images on deploy。
- Stack 右側可以設定 environment variable overrides；secret 會加密保存並在 deploy 時注入。
- Git stack 只會在 compose 所在目錄相關檔案有變更時自動 redeploy；手動 Deploy 永遠會強制 redeploy。

### 5.1 在 Dockhand 設定 Git repo

到：

```text
Settings -> Git
```

新增 GitHub repository。

如果 repo 是 private，需要設定 Git credential / token。若 repo 是 public，可以用公開 URL。

### 5.2 建立 Git Stack

到 Dockhand：

```text
Stacks -> Create stack -> Git stack
```

建議填：

```text
Stack name: lyzer
Repository: cytpress/lyzer
Branch: v2
Compose file path: docker-compose.yml
Context directory: .
Environment / Node: GL552VW 那台 Docker environment
```

如果之後 `v2` merge 回 `main`，再把 branch 改成 `main`。

### 5.3 Deploy options

因為 `api` service 使用 Dockerfile build：

```yaml
api:
  build:
    context: .
    dockerfile: packages/api/Dockerfile
```

Dockhand Git Stack deploy options 建議：

```text
Build images on deploy: ON
Disable build cache: OFF
Re-pull images: ON 或 OFF 都可
Force redeployment: OFF
```

說明：

- `Build images on deploy` 必開，否則 api image 不會從 Dockerfile build。
- `Disable build cache` 平常關閉，只有 dependency 或 base image 很怪時再開。
- `Re-pull images` 開啟可確保 `postgres:16-alpine` 更新，但不是必須。
- `Force redeployment` 平常不用，避免排程沒有變更也重啟。

### 5.4 設定 env / secrets

在 Git Stack 編輯器右側的 env panel 放部署環境變數。

建議標成 secret：

```bash
GEMINI_API_KEY
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
POSTGRES_PASSWORD
```

一般變數可不標 secret：

```bash
LYAPI_BASE_URL
LYAPI_GAZETTE_LIMIT
LYAPI_AGENDA_LIMIT
GEMINI_MODEL_NAME
ANALYZE_BATCH_SIZE
MAX_ANALYSIS_CHARS
SSG_API_BASE
CLOUDFLARE_PAGES_PROJECT_NAME
```

目前 compose 裡 Postgres 帳密還是固定：

```yaml
POSTGRES_DB: lyzer
POSTGRES_USER: lyzer
POSTGRES_PASSWORD: lyzer
```

正式部署前建議改成 `${POSTGRES_PASSWORD}`，並同步調整 `DATABASE_URL`。

### 5.5 Deploy

按：

```text
Save and Deploy
```

部署完成後，到 Stack containers 檢查：

- `lyzer-postgres`
- `lyzer-api`

查看 logs，確認沒有 migration / DB / env 錯誤。

## 6. 部署後檢查 API

在 Dockhand container logs 或 GL552VW shell 確認 Hono 啟動。

如果 API port 允許從你的機器連：

```bash
curl http://GL552VW_TAILSCALE_IP:3000/health
```

預期應該看到健康狀態回應。

如果只綁 localhost，就在 GL552VW 上執行：

```bash
curl http://127.0.0.1:3000/health
```

## 7. 在 Dockhand 裡跑 jobs

Dockhand 通常可以進 container terminal。進 `api` container 後，工作目錄應該是：

```bash
/app
```

先確認：

```bash
pwd
pnpm --filter @lyzer/api db:migrate
```

然後用小批次跑：

```bash
FETCH_PAGES=1 pnpm --filter @lyzer/api job:fetch
ANALYZE_LIMIT=1 pnpm --filter @lyzer/api job:analyze
```

確認沒問題後：

```bash
pnpm --filter @lyzer/api job:build
```

最後 deploy 到 Cloudflare Pages：

```bash
pnpm --filter @lyzer/api job:deploy
```

完整流程：

```bash
pnpm --filter @lyzer/api job:daily
```

或從 root script：

```bash
pnpm job:daily
```

## 8. 第一次上線建議流程

第一次不要直接跑完整 daily。建議：

1. Deploy Dockhand stack。
2. 確認 `postgres` healthy。
3. 確認 `api` healthy。
4. 跑 `db:migrate`。
5. 跑 `FETCH_PAGES=1 job:fetch`。
6. 人工查 DB 是否有資料。
7. 跑 `ANALYZE_LIMIT=1 job:analyze`。
8. 人工檢查 `analysis_results.analysis_json`。
9. 跑 `job:build`。
10. 檢查 `packages/web/dist` 是否產生首頁、搜尋索引、詳細頁。
11. 跑 `job:deploy`。
12. 打開 Cloudflare Pages 網站。
13. 確認首頁、詳細頁、搜尋、收藏。
14. 再提高 `ANALYZE_LIMIT`。

## 9. 自動排程

有兩種做法。

### 做法 A：GL552VW host cron / systemd timer

在 GL552VW 上排程執行：

```bash
docker exec lyzer-api pnpm --filter @lyzer/api job:daily
```

container 名稱要依 Dockhand 實際顯示為準。

### 做法 B：Dockhand Git Stack schedule

Dockhand 的 Git stack schedule 主要是 sync/deploy stack，不等於跑 app 內部 daily job。

所以它適合用來更新 compose / image，不適合取代 `job:daily`。`job:daily` 仍建議用 host cron、systemd timer，或未來另外做一個 scheduler container。

## 10. Cloudflare Pages 注意事項

目前 deploy job 使用：

```bash
wrangler pages deploy packages/web/dist --project-name $CLOUDFLARE_PAGES_PROJECT_NAME
```

需要確認：

- `CLOUDFLARE_PAGES_PROJECT_NAME` 正確。
- `CLOUDFLARE_API_TOKEN` 有 Pages deploy 權限。
- `CLOUDFLARE_ACCOUNT_ID` 正確。
- 第一次 deploy 後，Cloudflare Pages 的 production branch / direct upload 狀態符合預期。

## 11. 常見問題

### Git stack deploy 失敗，找不到 compose file

確認：

```text
Compose file path = docker-compose.yml
Context directory = .
Branch = v2
```

也確認 repo 上真的有 `docker-compose.yml`。

### API image 沒有重 build

確認 Dockhand deploy option：

```text
Build images on deploy = ON
```

必要時手動 Deploy，或暫時開 `Disable build cache`。

### API 連不到 Postgres

container 內的 DB host 應該是 compose service name：

```bash
postgres
```

不是 `localhost`。container 內建議：

```bash
DATABASE_URL=postgresql://lyzer:password@postgres:5432/lyzer
```

### `job:build` 打不到 SSG API

container 裡如果 `SSG_API_BASE=http://127.0.0.1:3000`，代表在 api container 內打自己，通常可以。

如果 build 是在別的 container 或 host 跑，`127.0.0.1` 就會指向不同地方，要改成：

```bash
SSG_API_BASE=http://api:3000
```

或實際可連的 host / Tailscale URL。

### `job:deploy` wrangler 需要登入

container 裡不要做互動式 `wrangler login`。請用環境變數：

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

不要隨便 `down -v`，那會刪掉資料庫 volume。

## 12. 之後應該補的部署改善

- 把 Postgres password 改成 env secret。
- 移除或限制 Postgres exposed port。
- 限制 API port 只走 Tailscale / localhost。
- 補 healthcheck 到 api service。
- 補 scheduler container 或 systemd timer 範例。
- 補 backup 策略：
  - Postgres dump
  - volume backup
  - Cloudflare Pages deploy 不需要備份，因為可重 build。
- 補 production compose override，例如 `docker-compose.prod.yml`。

## 參考

- Dockhand manual: https://dockhand.pro/manual/
- Dockhand Git integration / Git stack 設定：見 manual 的 Compose Stacks -> Git integration。
- Docker Compose docs: https://docs.docker.com/compose/
