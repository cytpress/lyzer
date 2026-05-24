import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { closeDb } from "./db.js";
import { analyzePendingAgendas } from "./jobs/analyze.js";
import { fetchNewGazettes } from "./jobs/fetch.js";
import { deployCheck } from "./jobs/deployCheck.js";
import { migrate } from "./schema.js";
import { getAgendaDetail, getAgendaIds, getCommittees, getHomepageAgendas, getLegislatorStats } from "./ssg.js";
const app = new Hono();

const openApiSpec = {
  openapi: "3.0.0",
  info: { title: "Lyzer API Control Panel (Scalar)", version: "0.2.0" },
  paths: {
    "/jobs/fetch": {
      post: {
        tags: ["Jobs"],
        summary: "抓取最新/歷史公報 (Fetch/Backfill Gazettes)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  pages: { type: "number", description: "要抓取的頁數 (可選，預設為 1 頁)" },
                  startPage: { type: "number", description: "起始頁碼，可用於歷史資料 Backfill (可選，預設為第 1 頁)" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "OK" } },
      },
    },
    "/jobs/analyze": {
      post: {
        tags: ["Jobs"],
        summary: "分析公報發言 (Analyze Agenda Speeches)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  limit: { type: "number", description: "分析數量上限 (可選)" },
                  agendaId: {
                    type: "string",
                    description: "指定分析特定 agendaId 的公報 (可選，常用於單獨補跑失敗的公報)",
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: "OK" } },
      },
    },
    "/jobs/deploy-check": {
      post: {
        tags: ["Jobs"],
        summary: "檢查並觸發部署至 Cloudflare Pages (Deploy Check & Trigger)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  dryRun: { type: "boolean", description: "是否僅進行檢查而不觸發外部 Webhook (可選，預設為 false)" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "OK" } },
      },
    },
  },
};

app.get("/doc", (c) => c.json(openApiSpec));

// 具有防衝突 Namespace 的高顏值 Scalar API 互動控制台
app.get("/lyzer-console", (c) => {
  return c.html(`
    <!doctype html>
    <html>
      <head>
        <title>Lyzer API Console (Scalar)</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { margin: 0; }
        </style>
      </head>
      <body>
        <div id="scalar-app"></div>
        <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
        <script>
          Scalar.createApiReference('#scalar-app', {
            url: '/doc'
          });
        </script>
      </body>
    </html>
  `);
});

app.get("/health", (c) => c.json({ ok: true }));

app.post("/jobs/fetch", async (c) => {
  const body = await c.req
    .json<{ pages?: number; startPage?: number }>()
    .catch(() => ({ pages: undefined, startPage: undefined }));
  const result = await fetchNewGazettes({ pages: body.pages, startPage: body.startPage });
  return c.json(result);
});

app.post("/jobs/analyze", async (c) => {
  const body = await c.req
    .json<{ limit?: number; agendaId?: string }>()
    .catch(() => ({ limit: undefined, agendaId: undefined }));
  const result = await analyzePendingAgendas({ limit: body.limit, agendaId: body.agendaId });
  return c.json(result);
});

app.post("/jobs/deploy-check", async (c) => {
  const body = await c.req
    .json<{ dryRun?: boolean }>()
    .catch(() => ({ dryRun: undefined }));
  const result = await deployCheck({ dryRun: body.dryRun });
  return c.json(result);
});

app.get("/api/ssg/homepage", async (c) => c.json(await getHomepageAgendas()));
app.get("/api/ssg/agenda-ids", async (c) => c.json(await getAgendaIds()));
app.get("/api/ssg/agendas/:agenda_id", async (c) => {
  const detail = await getAgendaDetail(c.req.param("agenda_id"));
  if (!detail) return c.json({ error: "not found" }, 404);
  return c.json(detail);
});
app.get("/api/ssg/committees", async (c) => c.json(await getCommittees()));
app.get("/api/ssg/legislators", async (c) => c.json(await getLegislatorStats()));

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
    }
  );
}

process.on("SIGINT", () => {
  void closeDb().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void closeDb().finally(() => process.exit(0));
});

await main();
