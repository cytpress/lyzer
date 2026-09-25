# Lyzer 專案規範

## 部署與服務管理

Lyzer 的 Docker Compose stack 已經決議由 Dockhand 管理；這是本專案的既定規範與唯一部署入口，不是可選的替代方案。

- Lyzer 的正式 stack 名稱是 `lyzer`，由 Dockhand 的 Git Stack 追蹤 GitHub `main` 分支與 `docker-compose.yml`。
- 程式碼變更先在本機驗證，再以 Conventional Commit push 到 `origin/main`。
- 只要變更涉及 API、scheduler、Dockerfile、Compose 或環境變數，必須在 Dockhand 的 Lyzer Git Stack 執行更新、建置與部署，並從 Dockhand 確認服務狀態與 logs。
- 只修改 Astro 網站時，依 Cloudflare Pages 的 Git 整合部署；不需要重新部署 Ubuntu stack。
- 不得把 `docker compose up`、`docker compose down`、`docker compose restart`、`docker compose build`、`docker compose rm` 或直接替換 Lyzer container 當作正式部署或更新流程。檢查狀態可以使用唯讀指令，但不能繞過 Dockhand 變更正式服務。
- 若 Dockhand 的 UI/API/權限暫時不可用，先停止在部署步驟並回報，不得默默改用手動 Compose。

## 公開 Repo 與 Commit 歷史

- `origin/main` 是公開 repo 的主要開發與部署分支；`v2` 保留為遷移期間的回復參照。開發中的 WIP、`fixup` 或暫存 commit 只留在本機；push 前整理成可獨立閱讀的 Conventional Commit。
- 遠端只保留完成的功能、修正或文件 commit；大型變更可以分成多個有意義且各自可 review 的 commit，但不要留下純粹的中間狀態。
- 已經公開的歷史不可自行 force-push 重寫；若要整理既有遠端歷史，必須先取得使用者明確同意並確認沒有其他 clone 依賴該歷史。

## 機密與資料

- API key、token、密碼與 deploy hook 只能放在 Dockhand 的加密環境變數或本機未追蹤的 `.env`，不可寫入 commit、logs 或公開設定。
- 不得刪除或重建正式 PostgreSQL volume，也不得執行 `docker compose down -v`。除非使用者明確要求，資料庫操作不自動備份或清除。
- Dockhand 本身及其他非 Lyzer stack 不在本專案的維運範圍內。

## 程式碼清理

- 修改功能時一併移除已確認沒有引用的死碼、舊流程與無用設定。
- 刪除前先搜尋 repo 內的 import、route、script、Docker/CI 設定與文件引用；可能被外部 API 或人工操作使用的項目先列出，不要只因 repo 內找不到引用就直接刪除。

## 本機維運資料

詳細主機操作筆記保存在本機忽略檔 `docs/private-runbook.md`，不得加入公開 repo。開始維運前若該檔存在，先讀取操作細節；若不存在，以本檔規範為準。正式 Lyzer stack 的唯一部署入口仍是 Dockhand。
