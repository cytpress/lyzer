# Lyzer v2 維運說明

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
- Branch：`v2`
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

`LYZER_JOB_TOKEN` 建議用 `openssl rand -hex 32` 產生。首次接管現有環境時必須沿用 Compose project name `lyzer`，才能繼續使用 `lyzer_postgres_data` volume。

## 排程

排程器使用 `Asia/Taipei` 時區：

- 每 5 分鐘：分析待處理議程，單次數量由 `ANALYZE_LIMIT` 控制。
- 每天 02:00：抓取最新公報，頁數由 `FETCH_PAGES` 控制。
- 每天 05:00：檢查是否有新分析，必要時呼叫 Cloudflare Pages deploy hook。

手動執行時，應從 Dockhand 開啟 scheduler container shell，再執行 `/app/scripts/lyzer-fetch.sh`、`/app/scripts/lyzer-analyze.sh` 或 `/app/scripts/lyzer-deploy-check.sh`。這些腳本會沿用 container 內的 API URL 與 token。

## 更新與驗證

一般更新流程：

1. 將變更 push 到 GitHub `v2`。
2. 等 GitHub Actions 通過。
3. 在 Dockhand 對 Lyzer Git Stack 執行 update/redeploy；完成 webhook 後可由 CI 自動觸發同一動作。
4. 確認四個 container 都是 healthy/running，並檢查 scheduler 與 API logs。

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

Cloudflare Pages 的正式專案是 `lyzer`，正式 branch 為 `v2`，正式網域為 `lyzer.tw`。Pages 建置透過 `api.lyzer.tw` 讀取 SSG 資料；deploy hook 只保存於秘密環境變數。

舊版 `main`、Vercel 與 Supabase 遷移不在這份維運流程內。在退役舊版前，仍需把 Supabase `find-by-agenda-id` 的轉址改到 `https://lyzer.tw/gazettes/<agenda_id>`。
