import { closeDb } from "./db.js";
import { analyzePendingAgendas } from "./jobs/analyze.js";
import { buildStaticSite } from "./jobs/build.js";
import { deployStaticSite } from "./jobs/deploy.js";
import { fetchNewGazettes } from "./jobs/fetch.js";
import { runDailyJob } from "./jobs/daily.js";
import { migrate } from "./schema.js";

function readIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  await migrate();

  switch (command) {
    case "db:migrate":
      console.log(JSON.stringify({ ok: true }, null, 2));
      break;
    case "job:fetch":
      console.log(JSON.stringify(await fetchNewGazettes({ pages: readIntEnv("FETCH_PAGES") }), null, 2));
      break;
    case "job:analyze":
      console.log(JSON.stringify(await analyzePendingAgendas({ limit: readIntEnv("ANALYZE_LIMIT") }), null, 2));
      break;
    case "job:build":
      console.log(JSON.stringify(await buildStaticSite(), null, 2));
      break;
    case "job:deploy":
      console.log(JSON.stringify(await deployStaticSite(), null, 2));
      break;
    case "job:daily":
      console.log(JSON.stringify(await runDailyJob(), null, 2));
      break;
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
}

try {
  await main();
} finally {
  await closeDb();
}
