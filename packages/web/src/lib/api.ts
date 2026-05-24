import type { AgendaDetail, HomepageAgenda, LegislatorSpeechStat } from "../types";

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

export function getAgendaIds(): Promise<string[]> {
  return getJson<string[]>("/api/ssg/agenda-ids");
}

export function getAgendaDetail(agendaId: string): Promise<AgendaDetail> {
  return getJson<AgendaDetail>(`/api/ssg/agendas/${encodeURIComponent(agendaId)}`);
}

export function getCommittees(): Promise<string[]> {
  return getJson<string[]>("/api/ssg/committees");
}

export function getLegislatorStats(): Promise<LegislatorSpeechStat[]> {
  return getJson<LegislatorSpeechStat[]>("/api/ssg/legislators");
}
