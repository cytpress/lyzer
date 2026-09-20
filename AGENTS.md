# Lyzer 專案規範

## 部署與服務管理

Lyzer 的 Docker Compose stack 已經決議由 Dockhand 管理；這是本專案的既定規範與唯一部署入口，不是可選的替代方案。

- Lyzer 的正式 stack 名稱是 `lyzer`，由 Dockhand 的 Git Stack 追蹤 GitHub `v2` 分支與 `docker-compose.yml`。
- 程式碼變更先在本機驗證，再以 Conventional Commit push 到 `origin/v2`。
- 只要變更涉及 API、scheduler、Dockerfile、Compose 或環境變數，必須在 Dockhand 的 Lyzer Git Stack 執行更新、建置與部署，並從 Dockhand 確認服務狀態與 logs。
- 只修改 Astro 網站時，依 Cloudflare Pages 的 Git 整合部署；不需要重新部署 Ubuntu stack。
- 不得把 `docker compose up`、`docker compose down`、`docker compose restart`、`docker compose build`、`docker compose rm` 或直接替換 Lyzer container 當作正式部署或更新流程。檢查狀態可以使用唯讀指令，但不能繞過 Dockhand 變更正式服務。
- 若 Dockhand 的 UI/API/權限暫時不可用，先停止在部署步驟並回報，不得默默改用手動 Compose。

## 機密與資料

- API key、token、密碼與 deploy hook 只能放在 Dockhand 的加密環境變數或本機未追蹤的 `.env`，不可寫入 commit、logs 或公開設定。
- 不得刪除或重建正式 PostgreSQL volume，也不得執行 `docker compose down -v`。除非使用者明確要求，資料庫操作不自動備份或清除。
- Dockhand 本身及其他非 Lyzer stack 不在本專案的維運範圍內。

## 參考文件

執行日常開發、更新與部署前，先讀取 [`ops/README.md`](ops/README.md)；若本檔與操作細節有衝突，以本檔的 Dockhand 唯一入口規範為準。
