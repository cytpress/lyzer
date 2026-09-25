// 產生全文搜尋索引的靜態分段清單
import type { APIRoute } from "astro";
import { getHomepageAgendas } from "@/lib/api";
import { SEARCH_INDEX_CHUNK_SIZE } from "@/lib/search";

export const prerender = true;

export const GET: APIRoute = async () => {
  const agendas = await getHomepageAgendas();
  const chunkCount = Math.ceil(agendas.length / SEARCH_INDEX_CHUNK_SIZE);

  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      chunks: Array.from({ length: chunkCount }, (_, index) => `/search-index/${index}.json`),
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
};
