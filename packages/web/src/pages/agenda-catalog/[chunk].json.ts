// 輸出單一分段的首頁篩選目錄資料
import type { APIRoute } from "astro";
import { getHomepageAgendas } from "@/lib/api";
import { AGENDA_CATALOG_CHUNK_SIZE, toAgendaCatalogItem } from "@/lib/catalog";
import { createPageCacheKey } from "@/lib/incremental";

export const prerender = true;

export async function getStaticPaths() {
  const catalog = (await getHomepageAgendas()).map(toAgendaCatalogItem);
  const chunkCount = Math.ceil(catalog.length / AGENDA_CATALOG_CHUNK_SIZE);

  return Array.from({ length: chunkCount }, (_, index) => {
    const agendas = catalog.slice(index * AGENDA_CATALOG_CHUNK_SIZE, (index + 1) * AGENDA_CATALOG_CHUNK_SIZE);
    return {
      params: { chunk: String(index) },
      props: { agendas },
      cacheKey: createPageCacheKey(agendas),
    };
  });
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.agendas), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
