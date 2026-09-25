# Lyzer 維運說明

這台 Ubuntu 主機只使用一套 Lyzer 執行架構：GitHub 保存原始碼，`docker-compose.yml` 定義服務，Dockhand 管理完整 Compose stack。Cloudflare Pages 發布靜態網站，Cloudflare Tunnel 將 API 提供給 Pages 建置流程。不要再用 systemd timer 或另一份 `docker compose up` 長期管理同一組服務。

## 服務架構

| 服務        | 用途                                | 對外方式                                                 |
| ----------- | ----------------------------------- | -------------------------------------------------------- |
| `postgres`  | 保存公報、議程與分析結果            | 僅主機 `127.0.0.1:5432`                                  |
| `api`       | 抓取、分析、部署檢查與 SSG 讀取 API | 僅主機 `127.0.0.1:3020`；另由 Tunnel 提供 `api.lyzer.tw` |
| `scheduler` | 執行抓取、分析及部署檢查            | 無主機連接埠                                             |
| `tunnel`    | 將 API 連到 Cloudflare              | 僅建立向外連線                                           |

資料流程：

```text
LYAPI -> fetch -> PostgreSQL -> analyze -> Gemini
PostgreSQL -> SSG API -> Cloudflare Pages build -> lyzer.tw
```

`POST /jobs/*` 一律需要 `Authorization: Bearer <LYZER_JOB_TOKEN>`。`/health` 與 `/api/ssg/*` 保持公開，讓健康檢查與 Cloudflare Pages 建置可以讀取。

## Dockhand Git Stack

在 Dockhand 建立一個 Git Stack，並讓它成為 Lyzer 在這台主機上的唯一部署入口：

- Repository：`https://github.com/cytpress/lyzer.git`
- Branch：`main`
- Compose path：`docker-compose.yml`
- Project/stack name：`lyzer`
- 更新方式：先拉取指定 branch，再重新建置並部署整個 stack

Dockhand 中需設定以下環境變數。值只放在 Dockhand 的加密環境變數或本機未追蹤的 `.env`，不可 commit：

```text
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
GEMINI_API_KEY
GEMINI_MODEL_NAME
CLOUDFLARE_DEPLOY_HOOK_URL
TUNNEL_TOKEN
LYZER_JOB_TOKEN
FETCH_PAGES
ANALYZE_LIMIT
```

若要讓本機維運工具在使用者明確要求時操作 Dockhand，可使用 repo 外的本機認證檔 `/home/cytpress/.config/lyzer/dockhand.env`。檔案只保存變數名稱與秘密值，不要把 token 寫入 repo、README、logs 或 command history；建議使用只允許管理 `lyzer` stack 的專用 token，並定期輪替：

```env
DOCKHAND_BASE_URL=http://127.0.0.1:3000
DOCKHAND_API_TOKEN=<local-secret>
```

本機認證檔應設為僅本人可讀（`chmod 600`）。未收到明確的更新或部署要求時，不會因讀取到此 token 而自動操作正式服務；若 Dockhand API 或權限不可用，應停止在部署步驟，不得改用手動 Compose。

`LYZER_JOB_TOKEN` 建議用 `openssl rand -hex 32` 產生。首次接管現有環境時必須沿用 Compose project name `lyzer`，才能繼續使用 `lyzer_postgres_data` volume。

## 排程

排程器使用 `Asia/Taipei` 時區：

- 每 3 分鐘：分析待處理議程，單次數量由 `ANALYZE_LIMIT` 控制。
- 每天 02:00：抓取最新公報，頁數由 `FETCH_PAGES` 控制。
- 每天 05:00：檢查是否有新分析，必要時呼叫 Cloudflare Pages deploy hook。

手動執行時，應從 Dockhand 開啟 scheduler container shell，再執行 `/app/scripts/lyzer-fetch.sh`、`/app/scripts/lyzer-analyze.sh` 或 `/app/scripts/lyzer-deploy-check.sh`。這些腳本會沿用 container 內的 API URL 與 token。

## 日常開發

正式開發分支只有 `main`。一般變更建議建立短期 feature branch，完成後用 Pull Request 合併到 `main`；小型維運修正也可直接 commit 到 `main`。GitHub Actions 只驗證 `main` 與目標為 `main` 的 Pull Request。commit 使用 Conventional Commits，例如 `feat: 新增搜尋功能`、`fix: 修正部署設定`，並在 body 用項目符號補充細節。

首次安裝或切換工具鏈：

```bash
cd /home/cytpress/projects/lyzer
fnm use
corepack enable
pnpm install --frozen-lockfile
```

提交前至少執行：

```bash
pnpm lint
pnpm typecheck
pnpm --filter @lyzer/api build
```

只開發網站時，可以直接讀正式的公開 SSG API：

```bash
SSG_API_BASE=https://api.lyzer.tw pnpm dev:web
```

開發 API、migration 或 job 時，必須準備獨立的開發 PostgreSQL，並用 `DATABASE_URL` 明確指向它，再執行 `pnpm dev:api`。不要把測試 migration、fetch 或 analyze 指向正式的 `lyzer_postgres_data`。

## 程式更新與部署

網站與 Ubuntu 服務是兩條部署路徑：

1. 將變更 push 或合併到 GitHub `main`。
2. GitHub Actions 執行 lint、型別檢查、API build 與 Compose 驗證。
3. Cloudflare Pages 的 Git 整合會接收 `main` push；當變更符合目前的 `packages/web/*` 路徑篩選時，才會自動建置並更新正式站 `lyzer.tw`。其他 commit 在 Pages 顯示為 `Idle` 是正常現象。
   - `lyzer.pages.dev` 透過 Cloudflare Bulk Redirect 永久轉址至 `lyzer.tw`，並保留路徑與 query string；它不再提供第二份公開網站。
   - 測試網站變更時，從 `main` 開 feature branch 並開 PR；Cloudflare Pages 會建立 branch/hash Preview 網址，供合併前檢查。Pages Preview 預設帶有 `X-Robots-Tag: noindex`，目前專案也對版本子網域明確套用相同標頭。
4. GitHub Actions 通過後，若變更涉及 API、scheduler、Dockerfile 或 Compose，進入 Dockhand 的 `lyzer` Git Stack 按 update/deploy。
5. 只修改網站時，不需要重新部署 Ubuntu stack。
6. 確認四個 container 都是 healthy/running，並檢查 scheduler 與 API logs。

若根目錄的 `package.json`、lockfile 或共用設定有變更且會影響網站，現有 Pages 路徑篩選不一定會啟動建置；此時應手動觸發 deploy hook，或一併調整 Pages 的 build watch paths。

目前 Dockhand 採人工一鍵部署，沒有開啟公開 webhook。這可避免 CI 尚未完成時自動更新 Ubuntu。若日後要全自動化，應讓 CI 成功後再呼叫受保護的 Dockhand webhook。

## 資料更新與網站重建

資料更新不需要 commit 或部署程式：

1. scheduler 定期抓取 LYAPI 資料並分析待處理議程。
2. 每天的 deploy-check 發現新的完成資料後，呼叫 Cloudflare Pages deploy hook。
3. Pages 從 `api.lyzer.tw` 讀取最新資料，重新產生 Astro 靜態頁面。

需要立刻更新網站資料時，可在 Dockhand 的 scheduler container 手動執行 `/app/scripts/lyzer-deploy-check.sh`。

## 部署驗證

部署後的基本檢查：

```bash
curl --fail http://127.0.0.1:3020/health
curl --fail https://api.lyzer.tw/health
docker compose ps
docker compose logs --tail=100 api scheduler tunnel
```

未帶 token 呼叫 job 應回傳 `401`。若需從主機手動觸發，可先載入未追蹤的 `.env`，再使用相同 Bearer token；不要把 token 寫進 shell history 或 log。

## 資料與回復

PostgreSQL 資料保存在 Docker volume `lyzer_postgres_data`。更新應避免刪除 volume，也不要執行 `docker compose down -v`。

程式回復方式是讓 Dockhand checkout 已知可用的 commit，重新 build 並部署。資料庫異動前先用 `pg_dump` 備份；若異動無法向後相容，程式回復與資料庫回復必須一起規劃。

Cloudflare Pages 的正式專案是 `lyzer`，正式 branch 為 `main`，正式網域為 `lyzer.tw`。Pages 建置透過 `api.lyzer.tw` 讀取 SSG 資料；`lyzer-build` deploy hook 也綁定 `main`，hook URL 只保存於秘密環境變數。

Vercel 專案只保留舊網址轉址設定；Supabase repo source 只保留 `find-by-agenda-id` 舊連結轉址 function，其程式碼位於 `backend/supabase/functions/find-by-agenda-id/`。此 function 直接向 `api.lyzer.tw` 確認公開頁面，不依賴 Supabase 資料庫。一般網站發布由 Cloudflare Pages 的 `main` 分支負責，Ubuntu stack 則由 Dockhand 追蹤 `main`。2026-09-25 已解除 Vercel 專案 `cytpress-projects/lyzer` 的 Git 連線，既有 Production 轉址部署仍在線，但 push 不會再觸發 Vercel 部署。

2026-09-25 已停用 Supabase `analyze`、`fetch`、`rescue` 三個 cron jobs，並刪除舊的 `analyze-pending-agendas`、`fetch-new-gazettes`、`rescue-stuck-analyses`、`backfill-fks`、`backfill-historical-gazettes` Edge Functions。為讓舊連結轉址不依賴舊資料，已部署 `find-by-agenda-id` v8，並移除舊 V1 的 public tables、views 與排程 HTTP/cron 紀錄；Supabase 目前只保留轉址 function，Storage 沒有 bucket 或檔案。清理後 `pg_database_size` 仍回報 644 MB，但目前資料表總量約 14 MB 且 CLI 未偵測到資料膨脹；若 Supabase 用量頁刷新後仍顯示超額，需由 Supabase 檢查資料表以外的磁碟占用。
