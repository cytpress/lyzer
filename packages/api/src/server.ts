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
import { swaggerUI } from "@hono/swagger-ui";

const app = new Hono();

const openApiSpec = {
  openapi: "3.0.0",
  info: { title: "Lyzer API Control Panel", version: "0.1.0" },
  paths: {
    "/admin/jobs/fetch": {
      post: {
        tags: ["Jobs"],
        summary: "抓取最新公報 (Fetch New Gazettes)",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { pages: { type: "number", description: "要抓取的頁數 (可選)" } } } } }
        },
        responses: { 200: { description: "OK" } }
      }
    },
    "/admin/jobs/analyze": {
      post: {
        tags: ["Jobs"],
        summary: "分析待處理議程 (Analyze Pending Agendas)",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { limit: { type: "number", description: "分析數量上限 (可選)" } } } } }
        },
        responses: { 200: { description: "OK" } }
      }
    },
    "/admin/jobs/build": {
      post: {
        tags: ["Jobs"],
        summary: "構建靜態網站 (Build Static Site)",
        responses: { 200: { description: "OK" } }
      }
    },
    "/admin/jobs/deploy": {
      post: {
        tags: ["Jobs"],
        summary: "部署至 Cloudflare Pages (Deploy to Cloudflare)",
        responses: { 200: { description: "OK" } }
      }
    },
    "/admin/jobs/daily": {
      post: {
        tags: ["Jobs"],
        summary: "執行每日例行任務 (Run Daily Job)",
        responses: { 200: { description: "OK" } }
      }
    }
  }
};

app.get("/doc", (c) => c.json(openApiSpec));
app.get("/ui", swaggerUI({ url: "/doc" }));

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
      hostname: "0.0.0.0",
    },
    (info) => {
      console.log(`lyzer API listening on http://0.0.0.0:${info.port}`);
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
