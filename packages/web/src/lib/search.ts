import type { Options } from "minisearch";

export interface SearchDocument {
  id: string;
  agendaId: string;
  gazetteId: string;
  meetingDate: string | null;
  committee: string | null;
  summaryTitle: string;
  overallSummary: string;
  subject: string | null;
  agendaItems: string;
  legislators: string;
  respondents: string;
  resultAndNextSteps: string;
}

const cjkPattern = /[\u3400-\u9fff]/;
const chunksPattern = /[\u3400-\u9fff]+|[a-z0-9]+/gi;

const aliases: Record<string, string> = {
  勞基法: "勞動基準法",
  長照: "長期照顧",
  健保: "全民健康保險",
  兒少: "兒童及少年",
};

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const chunks = text.toLowerCase().match(chunksPattern) ?? [];

  for (const chunk of chunks) {
    if (cjkPattern.test(chunk)) {
      if (chunk.length === 1) {
        tokens.push(chunk);
        continue;
      }

      for (let index = 0; index < chunk.length - 1; index += 1) {
        tokens.push(chunk.slice(index, index + 2));
      }
    } else {
      tokens.push(chunk);
    }
  }

  return tokens;
}

export function expandQuery(query: string): string {
  let expanded = query.trim();
  for (const [alias, full] of Object.entries(aliases)) {
    if (expanded.includes(alias) && !expanded.includes(full)) {
      expanded += ` ${full}`;
    }
  }
  return expanded;
}

export const miniSearchOptions: Options<SearchDocument> = {
  fields: [
    "summaryTitle",
    "overallSummary",
    "committee",
    "subject",
    "agendaItems",
    "legislators",
    "respondents",
    "resultAndNextSteps",
  ],
  storeFields: ["agendaId", "summaryTitle", "overallSummary", "committee", "meetingDate"],
  searchOptions: {
    boost: {
      summaryTitle: 3,
      subject: 2,
      committee: 1.5,
    },
    fuzzy: 0.2,
    prefix: true,
  },
  tokenize,
};
