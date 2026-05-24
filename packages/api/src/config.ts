import "dotenv/config";

// 本機獨立開發 (非 Docker 容器化) 的 fallback 預設連線字串
// 生產環境/容器化部署的資料庫連線字串統一由 `docker-compose.yml` 中的環境變數注入
const DEFAULT_DATABASE_URL = "postgresql://lyzer:lyzer@localhost:5432/lyzer";

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  port: readInt("PORT", 3000),
  lyapiBaseUrl: process.env.LYAPI_BASE_URL ?? "https://ly.govapi.tw/v2",
  lyapiGazetteLimit: readInt("LYAPI_GAZETTE_LIMIT", 20),
  lyapiAgendaLimit: readInt("LYAPI_AGENDA_LIMIT", 100),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModelName: process.env.GEMINI_MODEL_NAME ?? "gemini-3-flash-preview",
  analyzeBatchSize: readInt("ANALYZE_BATCH_SIZE", 3),
  ssgApiBase: process.env.SSG_API_BASE ?? "http://127.0.0.1:3000",
  cloudflareDeployHookUrl: process.env.CLOUDFLARE_DEPLOY_HOOK_URL ?? "",
};
