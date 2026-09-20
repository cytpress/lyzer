import type { APIRoute } from "astro";
import { getHomepageAgendas } from "../../lib/api";
import { AGENDA_CATALOG_CHUNK_SIZE } from "../../lib/catalog";
import type { HomepageAgenda } from "../../types";

export const prerender = true;

export async function getStaticPaths() {
  const agendas = await getHomepageAgendas();
  const chunkCount = Math.ceil(agendas.length / AGENDA_CATALOG_CHUNK_SIZE);

  return Array.from({ length: chunkCount }, (_, index) => ({
    params: { chunk: String(index) },
    props: {
      agendas: agendas.slice(index * AGENDA_CATALOG_CHUNK_SIZE, (index + 1) * AGENDA_CATALOG_CHUNK_SIZE),
    },
  }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.agendas as HomepageAgenda[]), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
