import { config } from "../config.js";
import { repoRoot, runCommand } from "../util.js";

export async function deployStaticSite(): Promise<{ ok: true }> {
  if (!config.cloudflarePagesProjectName) {
    throw new Error("CLOUDFLARE_PAGES_PROJECT_NAME is required for deployment");
  }

  await runCommand(
    "pnpm",
    [
      "--filter",
      "@lyzer/api",
      "exec",
      "wrangler",
      "pages",
      "deploy",
      "packages/web/dist",
      "--project-name",
      config.cloudflarePagesProjectName,
    ],
    { cwd: repoRoot() }
  );

  return { ok: true };
}
