import { config } from "../config.js";
import { query } from "../db.js";

export interface DeployCheckResult {
  shouldDeploy: boolean;
  newCompletedAnalyses: number;
  latestAnalyzedAt: string | null;
  deployTriggered: boolean;
}

export async function deployCheck(options: { dryRun?: boolean } = {}): Promise<DeployCheckResult> {
  const dryRun = options.dryRun ?? false;

  // 1. 讀取 job_state['cloudflare_deploy'] 取得上次部署時間
  const stateResult = await query<{ value: { last_deployed_analysis_at: string | null } }>(
    `select value from job_state where key = $1`,
    ["cloudflare_deploy"]
  );

  const lastDeployedAt = stateResult[0]?.value?.last_deployed_analysis_at
    ? new Date(stateResult[0].value.last_deployed_analysis_at)
    : new Date("1970-01-01T00:00:00.000Z");

  // 2. 查詢自上次部署後，新完成分析的公報數量與最新分析時間
  const analysisResult = await query<{ count: string; latest_analyzed_at: Date | null }>(
    `
      select
        count(*) as count,
        max(analyzed_at) as latest_analyzed_at
      from analysis_results
      where status = 'completed'
        and analyzed_at > $1
    `,
    [lastDeployedAt]
  );

  const count = Number.parseInt(analysisResult[0]?.count ?? "0", 10);
  const latestAnalyzedAt = analysisResult[0]?.latest_analyzed_at;

  // 3. 沒有新資料完成分析，跳過部署
  if (count === 0 || !latestAnalyzedAt) {
    return {
      shouldDeploy: false,
      newCompletedAnalyses: 0,
      latestAnalyzedAt: null,
      deployTriggered: false,
    };
  }

  // 4. 有新資料，如果為 dryRun 則只回傳預期結果，不觸發部署
  if (dryRun) {
    return {
      shouldDeploy: true,
      newCompletedAnalyses: count,
      latestAnalyzedAt: latestAnalyzedAt.toISOString(),
      deployTriggered: false,
    };
  }

  // 5. 執行正式部署 - 呼叫 Cloudflare Deploy Hook
  const hookUrl = config.cloudflareDeployHookUrl;
  if (!hookUrl) {
    throw new Error("CLOUDFLARE_DEPLOY_HOOK_URL is required for deployment check but is not configured.");
  }

  console.log(`[Deploy Check] Triggering Cloudflare Deploy Hook for ${count} new completed analyses...`);
  const response = await fetch(hookUrl, {
    method: "POST",
  }).catch((err) => {
    throw new Error(`Failed to contact Cloudflare Deploy Hook: ${err instanceof Error ? err.message : String(err)}`);
  });

  if (!response.ok) {
    throw new Error(`Cloudflare Deploy Hook responded with error: ${response.status} ${response.statusText}`);
  }

  // 6. 部署成功，更新 last_deployed_analysis_at 為最新分析時間
  await query(
    `
      insert into job_state (key, value, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (key) do update set
        value = excluded.value,
        updated_at = now()
    `,
    ["cloudflare_deploy", JSON.stringify({ last_deployed_analysis_at: latestAnalyzedAt.toISOString() })]
  );

  console.log(`[Deploy Check] Successfully triggered deploy. job_state updated to ${latestAnalyzedAt.toISOString()}`);

  return {
    shouldDeploy: true,
    newCompletedAnalyses: count,
    latestAnalyzedAt: latestAnalyzedAt.toISOString(),
    deployTriggered: true,
  };
}
