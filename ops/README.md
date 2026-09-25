# Lyzer 維運說明

這份公開文件只記錄專案的開發與部署邊界，不包含主機連線細節或機密設定

## 本機開發

```bash
fnm use
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm --filter @lyzer/api build
```

網站可在本機啟動；需要資料時，依開發情境設定 `SSG_API_BASE`

## 建置與部署

- GitHub Actions 只驗證推送到 `main` 的提交，以及目標為 `main` 的 Pull Request；它不會部署服務
- Cloudflare Pages 的 production branch 是 `main`，且目前只監看 `packages/web/*`；符合路徑條件的 `main` 變更會更新正式網站
- Cloudflare Pages 允許所有分支建立 Preview，因此網站路徑有變更時，其他分支也可能觸發預覽建置；只有 `main` 更新正式網站
- Astro 網站由 Cloudflare Pages Git 整合發布，不需要更新 Ubuntu stack
- API、排程器、Dockerfile 或 Compose 變更合併到 `main` 後，必須透過 Dockhand 的 Lyzer Git Stack 更新服務；Dockhand 是正式服務的唯一部署入口
- GitHub Actions 通過後，不會自動更新 Ubuntu 服務；部署前後都應在 Dockhand 確認服務狀態與 logs

## 機密與資料

- API key、token、密碼與 deploy hook 只存放於 Dockhand 加密環境變數或本機未追蹤的環境檔，不得提交到公開 repo
- PostgreSQL 資料保存在持久化 volume；未經明確決定，不得清除或重建資料庫 volume
- 正式服務更新不得繞過 Dockhand，直接以 Docker Compose 指令替換服務

commit 使用 Conventional Commits，並在 commit body 以項目符號補充變更內容
