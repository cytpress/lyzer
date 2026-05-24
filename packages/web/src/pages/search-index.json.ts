import MiniSearch from "minisearch";
import type { APIRoute } from "astro";
import { getHomepageAgendas } from "../lib/api";
import { miniSearchOptions, type SearchDocument } from "../lib/search";

export const prerender = true;

export const GET: APIRoute = async () => {
  const agendas = await getHomepageAgendas();
  const documents: SearchDocument[] = agendas.map((agenda) => ({
    id: agenda.agendaId,
    agendaId: agenda.agendaId,
    gazetteId: agenda.gazetteId,
    meetingDate: agenda.meetingDate,
    committee: agenda.committee,
    summaryTitle: agenda.summaryTitle,
    overallSummary: agenda.overallSummary,
    subject: agenda.subject,
    agendaItems: agenda.agendaItems.join(" "),
    legislators: agenda.legislators.join(" "),
    respondents: agenda.respondents.join(" "),
    resultAndNextSteps: agenda.resultAndNextSteps.join(" "),
  }));

  const miniSearch = new MiniSearch(miniSearchOptions);
  miniSearch.addAll(documents);

  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      index: JSON.stringify(miniSearch),
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
};
