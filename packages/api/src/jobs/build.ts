import { config } from "../config.js";
import { repoRoot, runCommand } from "../util.js";

export async function buildStaticSite(): Promise<{ ok: true }> {
  await runCommand("pnpm", ["--filter", "@lyzer/web", "build"], {
    cwd: repoRoot(),
    env: {
      ...process.env,
      SSG_API_BASE: config.ssgApiBase,
    },
  });

  return { ok: true };
}
