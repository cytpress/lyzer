// 驗證工作請求與模型回應，避免外部資料直接進入工作流程
import { z } from "zod";

const positiveCount = z.number().int().positive();

export const fetchJobSchema = z.object({
  pages: positiveCount.optional(),
  startPage: positiveCount.optional(),
});

export const analyzeJobSchema = z.object({
  limit: positiveCount.optional(),
  agendaId: z.string().trim().min(1).optional(),
});

export const deployCheckSchema = z.object({
  dryRun: z.boolean().optional(),
});

const speakerSchema = z.object({
  speaker_name: z.string().nullable(),
  speaker_viewpoint: z.array(z.string()).nullable().optional(),
});

const agendaItemSchema = z.object({
  item_title: z.string().nullable(),
  core_issue: z.array(z.string()).nullable().optional(),
  controversy: z.array(z.string()).nullable().optional(),
  legislator_speakers: z.array(speakerSchema).nullable().optional(),
  respondent_speakers: z.array(speakerSchema).nullable().optional(),
  result_status_next: z.array(z.string()).nullable().optional(),
});

export const analysisResultSchema = z.object({
  document_type: z.string(),
  is_public: z.boolean(),
  summary_title: z.string(),
  overall_summary_sentence: z.string(),
  committee_name: z.array(z.string()).nullable(),
  agenda_items: z.array(agendaItemSchema).nullable(),
});
