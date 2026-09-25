// 產生首頁篩選目錄的靜態分段清單
import type { APIRoute } from "astro";
import { getHomepageAgendas } from "@/lib/api";
import { AGENDA_CATALOG_CHUNK_SIZE } from "@/lib/catalog";

export const prerender = true;

export const GET: APIRoute = async () => {
  const agendas = await getHomepageAgendas();
  const chunkCount = Math.ceil(agendas.length / AGENDA_CATALOG_CHUNK_SIZE);

  return new Response(
    JSON.stringify({
      total: agendas.length,
      chunks: Array.from({ length: chunkCount }, (_, index) => `/agenda-catalog/${index}.json`),
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
};
