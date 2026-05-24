# Cloudflare 與網域相關設定紀錄

本文件僅作為設定備忘錄，記錄我們在各平台手動配置的項目。

## 1. 網域解析與託管 (Dynadot & Cloudflare DNS)
* **名稱伺服器 (NS)**：已將 Dynadot 預設名稱伺服器替換為 Cloudflare 指派的專屬名稱伺服器。
* **DNS 記錄**：當前的 DNS 記錄與快取（Proxy）已交由 Cloudflare 託管。

## 2. 安全通道 (Cloudflare Tunnel)
* **用途**：免開 Port 將 API 服務對接至專屬子網域。
* **Docker 配置**：在 `docker-compose.yml` 中新增了 `tunnel` 服務。
* **本地變數**：在伺服器本地 `.env` 中設定了 `TUNNEL_TOKEN`。
* **公共主機名稱**：設定 `api` 子網域直連本地容器的 `http://api:3000`。

## 3. 存取防護 (Cloudflare Zero Trust Access)
* **用途**：利用 Email 一次性驗證碼（OTP）保護後台介面。
* **防護路徑**：
  * 控制台路徑：鎖定 `/lyzer-console`。
  * 維運端點路徑：鎖定 `/jobs/*`。
* **存取原則**：設定僅限指定電子郵件通過驗證進入。
* **開放路徑**：唯讀資料介面（`/api/ssg/*`）保持公開，以利前端網站編譯與一般訪客瀏覽。

## 4. 前端託管與編譯 (Cloudflare Pages)
* **用途**：託管 Astro 靜態網站。
* **專案配置**：
  * 生產分支：`v2`
  * 建置指令：`pnpm --filter @lyzer/web build`
  * 輸出目錄：`packages/web/dist`
  * 環境變數：`SSG_API_BASE` 指向您的公開 API。
* **組建監視路徑 (Build Watch Paths)**：設定僅監視 `packages/web/**/*`，避免修改後端、資料庫或文檔時觸發無意義的前端編譯。
* **部署勾點 (Deploy Hook)**：已建立專屬的 Webhook 網址，用於在後端更新資料庫時手動或自動啟動雲端編譯。
