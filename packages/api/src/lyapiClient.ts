// 封裝 LYAPI 請求、重試與資料正規化
import { config } from "@/config";
import type {
  JsonObject,
  AgendaLawLink,
  NormalizedAgenda,
  NormalizedGazette,
  NormalizedMeeting,
  ProcessedUrl,
} from "@/types";

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

function asObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.map(asObject);
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

const COMMITTEE_MEETING_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const committeeMeetingsByDate = new Map<string, { expiresAt: number; promise: Promise<NormalizedMeeting[]> }>();

let nextLyapiRequestAt = 0;
let lyapiRequestQueue: Promise<void> = Promise.resolve();

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function scheduleLyapiRequest<T>(request: () => Promise<T>): Promise<T> {
  // 將同一個程序內的請求排成隊列，避免抓取多個公報時同時打到上游
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
    // 讓前一個請求失敗後後續請求仍能繼續排隊
    () => undefined,
    () => undefined
  );

  return scheduledRequest;
}

function get429RetryDelay(response: Response, retryCount: number): number {
  // 優先遵守上游提供的 Retry-After，沒有時才使用遞增等待時間
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
    raw,
  };
}

function normalizeMeeting(raw: JsonObject): NormalizedMeeting | null {
  const meetingId = asString(raw["會議代碼"]);
  if (!meetingId) return null;

  const agendaIds = asObjectArray(raw["公報發言紀錄"])
    .map((record) => asString(record.agenda_id))
    .filter((agendaId): agendaId is string => Boolean(agendaId));
  const bills = asObjectArray(raw["議事網資料"]).flatMap((record) => {
    const relation = asObject(record["關係文書"]);
    return asObjectArray(relation["議案"]).flatMap((bill) => {
      const lawIds = asStringArray(bill["法律編號"]);
      if (lawIds.length === 0) return [];
      return [{ lawIds, lawNames: asStringArray(bill["法律編號:str"]) }];
    });
  });

  return {
    meetingId,
    meetingType: asString(raw["會議種類"]),
    agendaIds: Array.from(new Set(agendaIds)),
    bills,
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

export async function listCommitteeMeetingsByDate(date: string): Promise<NormalizedMeeting[]> {
  const meetings: NormalizedMeeting[] = [];
  let page = 1;
  let totalPage: number;

  do {
    const url = createUrl("/meets", { 日期: date, limit: 100, page });
    for (const field of ["會議代碼", "會議種類", "公報發言紀錄", "議事網資料"]) {
      url.searchParams.append("output_fields", field);
    }
    const payload = await fetchJson(url);
    const items = Array.isArray(payload.meets) ? payload.meets : [];
    meetings.push(
      ...items
        .map((item) => normalizeMeeting(asObject(item)))
        .filter((meeting): meeting is NormalizedMeeting => Boolean(meeting))
        .filter((meeting) => meeting.meetingType === "委員會" || meeting.meetingType === "聯席會議")
    );
    totalPage = asNumber(payload.total_page) ?? 1;
    page += 1;
  } while (page <= totalPage);

  return meetings;
}

function getCommitteeMeetingsByDate(date: string): Promise<NormalizedMeeting[]> {
  const cached = committeeMeetingsByDate.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const request = listCommitteeMeetingsByDate(date).catch((error: unknown) => {
    if (committeeMeetingsByDate.get(date)?.promise === request) committeeMeetingsByDate.delete(date);
    throw error;
  });
  committeeMeetingsByDate.set(date, {
    expiresAt: Date.now() + COMMITTEE_MEETING_CACHE_TTL_MS,
    promise: request,
  });
  return request;
}

export async function getCommitteeMeetingsForAgendas(
  agendas: Array<{ agendaId: string; categoryCode: number | null; meetingDates: string[] }>
): Promise<Map<string, AgendaLawLink[]>> {
  const committeeAgendas = agendas.filter((agenda) => agenda.categoryCode === 3 && agenda.meetingDates.length > 0);
  const lawLinksByAgenda = new Map(
    committeeAgendas.map((agenda) => [agenda.agendaId, new Map<string, AgendaLawLink>()] as const)
  );
  const dates = Array.from(new Set(committeeAgendas.flatMap((agenda) => agenda.meetingDates)));
  const meetings = (await Promise.all(dates.map(getCommitteeMeetingsByDate))).flat();
  const matchingLinks = meetings.flatMap((meeting) => {
    const agendaIds = meeting.agendaIds.filter((agendaId) => lawLinksByAgenda.has(agendaId));
    if (agendaIds.length === 0) return [];

    return meeting.bills.flatMap((bill) =>
      bill.lawIds.flatMap((lawId, index) =>
        agendaIds.map((agendaId) => ({
          agendaId,
          lawId,
          lawName: bill.lawNames[index] ?? null,
        }))
      )
    );
  });

  matchingLinks.forEach(({ agendaId, lawId, lawName }) => {
    const laws = lawLinksByAgenda.get(agendaId);
    const existing = laws?.get(lawId);
    if (!existing || (!existing.lawName && lawName)) laws?.set(lawId, { lawId, lawName });
  });

  return new Map(Array.from(lawLinksByAgenda, ([agendaId, laws]) => [agendaId, Array.from(laws.values())] as const));
}
