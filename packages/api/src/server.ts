import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { closeDb } from "./db.js";
import { analyzePendingAgendas } from "./jobs/analyze.js";
import { buildStaticSite } from "./jobs/build.js";
import { deployStaticSite } from "./jobs/deploy.js";
import { fetchNewGazettes } from "./jobs/fetch.js";
import { runDailyJob } from "./jobs/daily.js";
import { migrate } from "./schema.js";
import { getAgendaDetail, getAgendaIds, getCommittees, getHomepageAgendas } from "./ssg.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/admin/jobs/fetch", async (c) => {
  const body = await c.req.json<{ pages?: number }>().catch(() => ({ pages: undefined }));
  const result = await fetchNewGazettes({ pages: body.pages });
  return c.json(result);
});

app.post("/admin/jobs/analyze", async (c) => {
  const body = await c.req.json<{ limit?: number }>().catch(() => ({ limit: undefined }));
  const result = await analyzePendingAgendas({ limit: body.limit });
  return c.json(result);
});

app.post("/admin/jobs/build", async (c) => c.json(await buildStaticSite()));
app.post("/admin/jobs/deploy", async (c) => c.json(await deployStaticSite()));
app.post("/admin/jobs/daily", async (c) => c.json(await runDailyJob()));

app.get("/api/ssg/homepage", async (c) => c.json(await getHomepageAgendas()));
app.get("/api/ssg/agenda-ids", async (c) => c.json(await getAgendaIds()));
app.get("/api/ssg/agendas/:agenda_id", async (c) => {
  const detail = await getAgendaDetail(c.req.param("agenda_id"));
  if (!detail) return c.json({ error: "not found" }, 404);
  return c.json(detail);
});
app.get("/api/ssg/committees", async (c) => c.json(await getCommittees()));

async function main(): Promise<void> {
  await migrate();

  serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.log(`lyzer API listening on http://127.0.0.1:${info.port}`);
    },
  );
}

process.on("SIGINT", () => {
  void closeDb().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void closeDb().finally(() => process.exit(0));
});

await main();
