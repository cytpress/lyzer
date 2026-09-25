// 註冊健康檢查、排程工作與公開 SSG API 路由
import { serve } from "@hono/node-server";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { config } from "@/config";
import { closeDb } from "@/db";
import { analyzePendingAgendas } from "@/jobs/analyze";
import { fetchNewGazettes } from "@/jobs/fetch";
import { deployCheck } from "@/jobs/deployCheck";
import { migrate } from "@/schema";
import {
  getAgendaDetail,
  getAgendaDetailsPage,
  getAgendaIds,
  getCommittees,
  getHomepageAgendas,
  getLegislatorStats,
} from "@/ssg";
const app = new Hono();

function hasValidJobToken(authorization: string | undefined): boolean {
  if (!config.jobToken || !authorization?.startsWith("Bearer ")) return false;

  const suppliedToken = authorization.slice("Bearer ".length);
  const expected = Buffer.from(config.jobToken);
  const supplied = Buffer.from(suppliedToken);

  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

app.get("/health", (c) => c.json({ ok: true }));

app.use("/jobs/*", async (c, next) => {
  if (!hasValidJobToken(c.req.header("Authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
});

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
  const body = await c.req.json<{ dryRun?: boolean }>().catch(() => ({ dryRun: undefined }));
  const result = await deployCheck({ dryRun: body.dryRun });
  return c.json(result);
});

app.get("/api/ssg/homepage", async (c) => c.json(await getHomepageAgendas()));
app.get("/api/ssg/agenda-ids", async (c) => c.json(await getAgendaIds()));
app.get("/api/ssg/agenda-details", async (c) => {
  const rawLimit = Number(c.req.query("limit") ?? "200");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 250) : 200;
  const cursor = c.req.query("cursor")?.trim() || undefined;
  return c.json(await getAgendaDetailsPage({ cursor, limit }));
});
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
