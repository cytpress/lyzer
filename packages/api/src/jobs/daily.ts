import { analyzePendingAgendas } from "./analyze.js";
import { buildStaticSite } from "./build.js";
import { fetchNewGazettes } from "./fetch.js";

export async function runDailyJob(): Promise<{
  fetch: Awaited<ReturnType<typeof fetchNewGazettes>>;
  analyze: Awaited<ReturnType<typeof analyzePendingAgendas>>;
  build: Awaited<ReturnType<typeof buildStaticSite>>;
}> {
  const fetch = await fetchNewGazettes();
  const analyze = await analyzePendingAgendas();
  const build = await buildStaticSite();

  return { fetch, analyze, build };
}
