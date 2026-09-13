import MiniSearch from "minisearch";
import type { APIRoute } from "astro";
import { getHomepageAgendas } from "../../lib/api";
import {
  SEARCH_INDEX_CHUNK_SIZE,
  miniSearchOptions,
  toSearchDocument,
} from "../../lib/search";
import type { HomepageAgenda } from "../../types";

export const prerender = true;

export async function getStaticPaths() {
  const agendas = await getHomepageAgendas();
  const chunkCount = Math.ceil(agendas.length / SEARCH_INDEX_CHUNK_SIZE);

  return Array.from({ length: chunkCount }, (_, index) => ({
    params: { chunk: String(index) },
    props: {
      agendas: agendas.slice(
        index * SEARCH_INDEX_CHUNK_SIZE,
        (index + 1) * SEARCH_INDEX_CHUNK_SIZE
      ),
    },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const agendas = props.agendas as HomepageAgenda[];
  const miniSearch = new MiniSearch(miniSearchOptions);
  miniSearch.addAll(agendas.map(toSearchDocument));

  return new Response(
    JSON.stringify({
      index: JSON.stringify(miniSearch),
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
};
