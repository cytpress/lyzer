import type { AgendaDetail, HomepageAgenda, LegislatorSpeechStat } from "../types";

interface AgendaDetailsPage {
  items: AgendaDetail[];
  nextCursor: string | null;
}

const ssgApiBase = import.meta.env.SSG_API_BASE ?? "http://127.0.0.1:3000";

async function getJson<T>(pathname: string): Promise<T> {
  const response = await fetch(new URL(pathname, ssgApiBase));
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
