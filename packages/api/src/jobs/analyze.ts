// 協調議程挑選、模型分析與工作狀態更新
import { config } from "@/config";
import { loadAgendaText } from "@/content";
import { analyzeWithGemini } from "@/gemini";
import { shouldSkipAnalysis } from "@/prompts";
import { isPermanentInputError, isTransientApiError } from "@/jobs/analyze/errors";
import { pickCandidates, type AnalyzeJobResult } from "@/jobs/analyze/candidates";
import { normalizeAnalysisResult } from "@/jobs/analyze/normalize";
import { markCompleted, markFailed, markPending, markProcessing } from "@/jobs/analyze/state";

export async function analyzePendingAgendas(
  options: { limit?: number; agendaId?: string } = {}
): Promise<AnalyzeJobResult> {
  const limit = options.limit ?? config.analyzeBatchSize;
  const result: AnalyzeJobResult = {
    picked: 0,
    completed: 0,
    failed: 0,
  };

  // 1. 如果指定了特定的 agendaId，只對其進行單次分析
  if (options.agendaId) {
    const candidates = await pickCandidates(1, options.agendaId);
    if (candidates.length === 0) return result;
    result.picked = 1;
    const agenda = candidates[0];
    if (agenda.category_code === null || shouldSkipAnalysis(agenda.category_code)) return result;
    await markProcessing(agenda.agenda_id);
    try {
      const sourceText = await loadAgendaText(agenda);
      const analysis = await analyzeWithGemini({
        categoryCode: agenda.category_code,
        sourceText,
      });
      await markCompleted(agenda.agenda_id, normalizeAnalysisResult(analysis, agenda.category_code));
      result.completed += 1;
    } catch (error) {
      console.error(error);
      if (isPermanentInputError(error)) {
        await markFailed(agenda.agenda_id, error);
        result.failed += 1;
      } else if (isTransientApiError(error)) {
        console.warn(
          `[Analyze Job] Gemini API transient error (429/503) detected for agenda ${agenda.agenda_id}. Resetting status to pending and aborting.`
        );
        await markPending(agenda.agenda_id);
      } else {
        await markFailed(agenda.agenda_id, error);
        result.failed += 1;
      }
    }
    return result;
  }

  // 2. 一般佇列分析：防卡死且自動補位機制
  // 為了防範外部網路全斷等極端狀況造成無限迴圈，設定最大嘗試次數為 limit * 3
  const maxAttempts = limit * 3;
  let attempts = 0;

  while (result.completed < limit && attempts < maxAttempts) {
    const needed = limit - result.completed;
    const candidates = await pickCandidates(needed);
    if (candidates.length === 0) {
      break;
    }

    for (const agenda of candidates) {
      attempts += 1;
      result.picked += 1;
      await markProcessing(agenda.agenda_id);
      try {
        const sourceText = await loadAgendaText(agenda);
        const analysis = await analyzeWithGemini({
          categoryCode: agenda.category_code ?? 0,
          sourceText,
        });
        await markCompleted(agenda.agenda_id, normalizeAnalysisResult(analysis, agenda.category_code));
        result.completed += 1;

        if (result.completed >= limit) {
          break;
        }
      } catch (error) {
        console.error(error);
        if (isPermanentInputError(error)) {
          await markFailed(agenda.agenda_id, error);
          result.failed += 1;
        } else if (isTransientApiError(error)) {
          console.warn(
            `[Analyze Job] Gemini API transient error (429/503) detected. Resetting agenda ${agenda.agenda_id} to pending and aborting queue immediately.`
          );
          await markPending(agenda.agenda_id);
          // 融斷保護：將 attempts 設為最大上限以立即跳出 while 迴圈
          attempts = maxAttempts;
          break;
        } else {
          await markFailed(agenda.agenda_id, error);
          result.failed += 1;
        }

        if (attempts >= maxAttempts) {
          break;
        }
      }
    }
  }

  return result;
}
