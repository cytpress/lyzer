import { config } from "../config.js";
import { loadAgendaText } from "../content.js";
import { query } from "../db.js";
import { analyzeWithGemini } from "../gemini.js";
import type { JsonObject } from "../types.js";

function cleanSpeakerName(name: string | null | undefined, isLegislator = false): string {
  if (!name) return "";

  // 1. 先把空格切開，提取出「名字部分」和「職稱部分」
  const parts = name.trim().replace(/\s+/g, " ").split(" ");
  let namePart = parts[0] ?? "";
  const titlePart = parts.slice(1).join(" ");

  // 2. 去除名字部分的 "立法委員"、"委員"、"立法"
  namePart = namePart
    .replace(/\s*(立法委員|委員|立法)\s*/g, "")
    .trim();

  // 3. 處理官員常見的「姓 + 職稱 + 名」格式，例如「莊部長翠雲」->「莊翠雲」
  const titleRegex = /^([\u4e00-\u9fa5])(部長|署長|局長|次長|主任委員|主任|主委|處長|組長|司長|科長|秘書長|常務次長|政務次長|代理部長|代理署長|代理局長|總經理|董事長|行長|理事長)([\u4e00-\u9fa5]+)$/;
  const match = namePart.match(titleRegex);
  if (match) {
    const lastName = match[1];
    const firstName = match[3];
    namePart = `${lastName}${firstName}`;
  }

  // 4. 重組回傳
  if (isLegislator) {
    // 立法委員統一後綴「立法委員」
    return `${namePart} 立法委員`;
  } else {
    // 官員/答詢代表保留原始完整職稱
    return titlePart ? `${namePart} ${titlePart}` : namePart;
  }
}

interface AgendaCandidate {
  agenda_id: string;
  meeting_dates: string[] | null;
  subject: string | null;
  parsed_url: string | null;
  txt_url: string | null;
  raw: JsonObject;
}

export interface AnalyzeJobResult {
  picked: number;
  completed: number;
  failed: number;
}

async function pickCandidates(limit: number, agendaId?: string): Promise<AgendaCandidate[]> {
  if (agendaId) {
    return query<AgendaCandidate>(
      `
        select
          a.agenda_id,
          a.meeting_dates,
          a.subject,
          a.parsed_url,
          a.txt_url,
          a.raw
        from agendas a
        where a.agenda_id = $1
      `,
      [agendaId]
    );
  }

  return query<AgendaCandidate>(
    `
      select
        a.agenda_id,
        a.meeting_dates,
        a.subject,
        a.parsed_url,
        a.txt_url,
        a.raw
      from agendas a
      left join analysis_results ar on ar.agenda_id = a.agenda_id
      where a.category_code in (3, 8)
        and (a.parsed_url is not null or a.txt_url is not null)
        and (
          ar.status is null
          or ar.status = 'pending'
          or (
            ar.status = 'processing'
            and ar.updated_at < now() - interval '30 minutes'
          )
        )
      order by coalesce(a.meeting_dates[1], date '1900-01-01') desc, a.agenda_id desc
      limit $1
    `,
    [limit]
  );
}

async function markProcessing(agendaId: string): Promise<void> {
  await query(
    `
      insert into analysis_results (agenda_id, status, error_message, updated_at)
      values ($1, 'processing', null, now())
      on conflict (agenda_id) do update set
        status = 'processing',
        error_message = null,
        updated_at = now()
    `,
    [agendaId]
  );
}

async function markCompleted(agendaId: string, analysis: JsonObject): Promise<void> {
  await query(
    `
      update analysis_results
      set status = 'completed',
          analysis_json = $2::jsonb,
          analyzed_at = now(),
          error_message = null,
          updated_at = now()
      where agenda_id = $1
    `,
    [agendaId, JSON.stringify(analysis)]
  );
}

async function markFailed(agendaId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await query(
    `
      update analysis_results
      set status = 'failed',
          error_message = $2,
          analyzed_at = now(),
          updated_at = now()
      where agenda_id = $1
    `,
    [agendaId, message.slice(0, 2000)]
  );
}

function isTransientApiError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();
  return (
    lowerMsg.includes("429") ||
    lowerMsg.includes("503") ||
    lowerMsg.includes("resource_exhausted") ||
    lowerMsg.includes("unavailable") ||
    lowerMsg.includes("quota exceeded") ||
    lowerMsg.includes("high demand")
  );
}

async function markPending(agendaId: string): Promise<void> {
  await query(
    `
      update analysis_results
      set status = 'pending',
          error_message = null,
          updated_at = now()
      where agenda_id = $1
    `,
    [agendaId]
  );
}

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
    await markProcessing(agenda.agenda_id);
    try {
      const sourceText = await loadAgendaText(agenda);
      const analysis = await analyzeWithGemini({
        agendaId: agenda.agenda_id,
        subject: agenda.subject,
        meetingDates: agenda.meeting_dates ?? [],
        sourceText,
      });

      if (Array.isArray(analysis.agenda_items)) {
        for (const item of analysis.agenda_items) {
          if (item && typeof item === "object") {
            const itemObj = item as JsonObject;
            if (Array.isArray(itemObj.legislator_speakers)) {
              for (const s of itemObj.legislator_speakers) {
                if (s && typeof s === "object") {
                  const sObj = s as JsonObject;
                  sObj.speaker_name = cleanSpeakerName(sObj.speaker_name as string, true);
                }
              }
            }
            if (Array.isArray(itemObj.respondent_speakers)) {
              for (const s of itemObj.respondent_speakers) {
                if (s && typeof s === "object") {
                  const sObj = s as JsonObject;
                  sObj.speaker_name = cleanSpeakerName(sObj.speaker_name as string);
                }
              }
            }
          }
        }
      }

      await markCompleted(agenda.agenda_id, analysis);
      result.completed += 1;
    } catch (error) {
      console.error(error);
      if (isTransientApiError(error)) {
        console.warn(`[Analyze Job] Gemini API transient error (429/503) detected for agenda ${agenda.agenda_id}. Resetting status to pending and aborting.`);
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
          agendaId: agenda.agenda_id,
          subject: agenda.subject,
          meetingDates: agenda.meeting_dates ?? [],
          sourceText,
        });

        if (Array.isArray(analysis.agenda_items)) {
          for (const item of analysis.agenda_items) {
            if (item && typeof item === "object") {
              const itemObj = item as JsonObject;
              if (Array.isArray(itemObj.legislator_speakers)) {
                for (const s of itemObj.legislator_speakers) {
                  if (s && typeof s === "object") {
                    const sObj = s as JsonObject;
                    sObj.speaker_name = cleanSpeakerName(sObj.speaker_name as string, true);
                  }
                }
              }
              if (Array.isArray(itemObj.respondent_speakers)) {
                for (const s of itemObj.respondent_speakers) {
                  if (s && typeof s === "object") {
                    const sObj = s as JsonObject;
                    sObj.speaker_name = cleanSpeakerName(sObj.speaker_name as string);
                  }
                }
              }
            }
          }
        }

        await markCompleted(agenda.agenda_id, analysis);
        result.completed += 1;

        if (result.completed >= limit) {
          break;
        }
      } catch (error) {
        console.error(error);
        if (isTransientApiError(error)) {
          console.warn(`[Analyze Job] Gemini API transient error (429/503) detected. Resetting agenda ${agenda.agenda_id} to pending and aborting queue immediately.`);
          await markPending(agenda.agenda_id);
          // 融斷保護：將 attempts 設為最大上限以立即跳出 while 迴圈
          attempts = maxAttempts;
          break;
        }
        await markFailed(agenda.agenda_id, error);
        result.failed += 1;

        if (attempts >= maxAttempts) {
          break;
        }
      }
    }
  }

  return result;
}
