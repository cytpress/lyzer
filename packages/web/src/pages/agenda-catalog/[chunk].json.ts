import type { APIRoute } from "astro";
import { getHomepageAgendas } from "../../lib/api";
import { AGENDA_CATALOG_CHUNK_SIZE, toAgendaCatalogItem } from "../../lib/catalog";

export const prerender = true;

export async function getStaticPaths() {
  const catalog = (await getHomepageAgendas()).map(toAgendaCatalogItem);
  const chunkCount = Math.ceil(catalog.length / AGENDA_CATALOG_CHUNK_SIZE);

  return Array.from({ length: chunkCount }, (_, index) => ({
    params: { chunk: String(index) },
    props: {
      agendas: catalog.slice(index * AGENDA_CATALOG_CHUNK_SIZE, (index + 1) * AGENDA_CATALOG_CHUNK_SIZE),
    },
  }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.agendas), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
