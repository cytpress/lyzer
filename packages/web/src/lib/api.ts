// 集中封裝 Astro 建置時讀取 SSG API 的請求
import type { AgendaDetail, HomepageAgenda, LegislatorSpeechStat } from "@/types";

interface AgendaDetailsPage {
  items: AgendaDetail[];
  nextCursor: string | null;
}

const ssgApiBase = import.meta.env.SSG_API_BASE ?? "http://127.0.0.1:3000";
const accessClientId = import.meta.env.LYZER_SSG_ACCESS_CLIENT_ID;
const accessClientSecret = import.meta.env.LYZER_SSG_ACCESS_CLIENT_SECRET;
const apiAccessRequired = import.meta.env.SSG_API_ACCESS_REQUIRED === "true";

function getAccessHeaders(): HeadersInit | undefined {
  if (!accessClientId && !accessClientSecret) {
    if (apiAccessRequired) {
      throw new Error("SSG API Access is required but its Cloudflare Access service token is not configured");
    }
    return undefined;
  }

  if (!accessClientId || !accessClientSecret) {
    throw new Error("Both Cloudflare Access service token credentials must be configured");
  }

  return {
    "CF-Access-Client-Id": accessClientId,
    "CF-Access-Client-Secret": accessClientSecret,
  };
}

async function getJson<T>(pathname: string): Promise<T> {
  const response = await fetch(new URL(pathname, ssgApiBase), { headers: getAccessHeaders() });
  if (!response.ok) {
    throw new Error(`SSG API request failed ${response.status}: ${pathname}`);
  }
  return response.json() as Promise<T>;
}

export function getHomepageAgendas(): Promise<HomepageAgenda[]> {
  return getJson<HomepageAgenda[]>("/api/ssg/homepage");
}

export async function getAgendaDetailsForBuild(): Promise<AgendaDetail[]> {
  const details: AgendaDetail[] = [];
  let cursor: string | null = null;

  // 建置時分頁讀取所有公開詳情，避免單次 API 回應超大
  while (true) {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);

    const page = await getJson<AgendaDetailsPage>(`/api/ssg/agenda-details?${params}`);
    details.push(...page.items);

    if (!page.nextCursor) return details;
    if (page.nextCursor === cursor) {
      throw new Error("SSG API returned a repeated agenda details cursor");
    }
    cursor = page.nextCursor;
  }
}

export function getCommittees(): Promise<string[]> {
  return getJson<string[]>("/api/ssg/committees");
}

export function getLegislatorStats(): Promise<LegislatorSpeechStat[]> {
  return getJson<LegislatorSpeechStat[]>("/api/ssg/legislators");
}
