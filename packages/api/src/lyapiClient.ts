import { config } from "./config.js";
import type { JsonObject, NormalizedAgenda, NormalizedGazette, ProcessedUrl } from "./types.js";

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function createUrl(pathname: string, params: Record<string, string | number | undefined>): URL {
  const url = new URL(`${config.lyapiBaseUrl.replace(/\/$/, "")}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

const LYAPI_REQUEST_INTERVAL_MS = 1_000;
const LYAPI_429_MAX_RETRIES = 3;
const LYAPI_429_FALLBACK_DELAYS_MS = [30_000, 60_000, 120_000] as const;

let nextLyapiRequestAt = 0;
let lyapiRequestQueue: Promise<void> = Promise.resolve();

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function scheduleLyapiRequest<T>(request: () => Promise<T>): Promise<T> {
  const scheduledRequest = lyapiRequestQueue.then(async () => {
    const waitMilliseconds = Math.max(0, nextLyapiRequestAt - Date.now());
    if (waitMilliseconds > 0) await sleep(waitMilliseconds);

    try {
      return await request();
    } finally {
      nextLyapiRequestAt = Date.now() + LYAPI_REQUEST_INTERVAL_MS;
    }
  });

  lyapiRequestQueue = scheduledRequest.then(
    () => undefined,
    () => undefined
  );

  return scheduledRequest;
}

function get429RetryDelay(response: Response, retryCount: number): number {
  const retryAfter = response.headers.get("Retry-After")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  }

  return LYAPI_429_FALLBACK_DELAYS_MS[Math.min(retryCount, LYAPI_429_FALLBACK_DELAYS_MS.length - 1)];
}

async function fetchJson(url: URL): Promise<JsonObject> {
  for (let retryCount = 0; ; retryCount += 1) {
    const response = await scheduleLyapiRequest(() =>
      fetch(url, {
        headers: {
          "User-Agent": "LyzerBot (+https://github.com/cytpress/lyzer)",
        },
      })
    );

    if (response.status === 429) {
      if (retryCount >= LYAPI_429_MAX_RETRIES) {
        throw new Error(`LYAPI request failed 429 after ${retryCount} retries: ${url.toString()}`);
      }

      await sleep(get429RetryDelay(response, retryCount));
      continue;
    }

    if (!response.ok) {
      throw new Error(`LYAPI request failed ${response.status}: ${url.toString()}`);
    }

    return asObject(await response.json());
  }
}

export function extractProcessedUrls(raw: JsonObject, type?: "parsed" | "txt"): ProcessedUrl[] {
  const urls = raw["處理後公報網址"];
  if (!Array.isArray(urls)) return [];

  return urls
    .map((item) => asObject(item))
    .map((item) => ({
      type: asString(item.type) ?? "",
      no: asNumber(item.no),
      url: asString(item.url) ?? "",
    }))
    .filter((item) => item.url && (!type || item.type === type))
    .sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
}

function normalizeGazette(raw: JsonObject): NormalizedGazette {
  const gazetteId = asString(raw["公報編號"]);
  if (!gazetteId) {
    throw new Error("LYAPI gazette missing 公報編號");
  }

  return {
    gazetteId,
    volume: asNumber(raw["卷"]),
    issue: asNumber(raw["期"]),
    booklet: asNumber(raw["冊別"]),
    publishDate: asString(raw["發布日期"]),
    raw,
  };
}

function normalizeAgenda(raw: JsonObject, fallbackGazetteId: string): NormalizedAgenda {
  const agendaId = asString(raw["公報議程編號"]);
  if (!agendaId) {
    throw new Error("LYAPI agenda missing 公報議程編號");
  }

  const processedUrls = extractProcessedUrls(raw);
  const parsedUrl = processedUrls.find((item) => item.type === "parsed")?.url ?? null;
  const txtUrl = processedUrls.find((item) => item.type === "txt")?.url ?? null;

  return {
    agendaId,
    gazetteId: asString(raw["公報編號"]) ?? fallbackGazetteId,
    meetingDates: asStringArray(raw["會議日期"]),
    subject: asString(raw["案由"]),
    categoryCode: asNumber(raw["類別代碼"]),
    parsedUrl,
    txtUrl,
    officialPageUrl: asString(raw["公報網網址"]),
    officialPdfUrl: asString(raw["公報完整PDF網址"]),
    processedUrls,
    raw,
  };
}

export async function listGazettes(page = 1, limit = config.lyapiGazetteLimit): Promise<NormalizedGazette[]> {
  const url = createUrl("/gazettes", { page, limit });
  const payload = await fetchJson(url);
  const items = Array.isArray(payload.gazettes) ? payload.gazettes : [];
  return items.map((item) => normalizeGazette(asObject(item)));
}

export async function listGazetteAgendas(
  gazetteId: string,
  limit = config.lyapiAgendaLimit
): Promise<NormalizedAgenda[]> {
  const agendas: NormalizedAgenda[] = [];
  let page = 1;
  let totalPage: number;

  do {
    const url = createUrl(`/gazettes/${encodeURIComponent(gazetteId)}/agendas`, { page, limit });
    const payload = await fetchJson(url);
    const items = Array.isArray(payload.gazetteagendas) ? payload.gazetteagendas : [];
    agendas.push(...items.map((item) => normalizeAgenda(asObject(item), gazetteId)));
    totalPage = asNumber(payload.total_page) ?? 1;
    page += 1;
  } while (page <= totalPage);

  return agendas;
}
