// 從公開摘要整理立委發言統計與時間軸
import { query } from "@/db";
import { asCommittee, asString, normalizeDate } from "@/ssg/normalize";
import type { JsonObject, LegislatorSpeechStat, LegislatorTimelineEvent } from "@/types";

export async function getLegislatorStats(): Promise<LegislatorSpeechStat[]> {
  const rows = await query<{
    agenda_id: string;
    meeting_dates: string[] | null;
    publish_date: string | null;
    subject: string | null;
    analysis_json: JsonObject;
  }>(`
    select
      a.agenda_id,
      a.meeting_dates,
      g.publish_date,
      a.subject,
      ar.analysis_json
    from agendas a
    join gazettes g on g.gazette_id = a.gazette_id
    join analysis_results ar on ar.agenda_id = a.agenda_id
    where ar.status = 'completed'
      and coalesce(ar.is_public, true)
    order by coalesce(a.meeting_dates[1], date '1900-01-01') desc, a.agenda_id desc
  `);

  const legislatorMap = new Map<string, LegislatorSpeechStat>();

  for (const row of rows) {
    const analysis = row.analysis_json ?? {};
    const agendaItems = Array.isArray(analysis.agenda_items) ? analysis.agenda_items : [];
    const meetingDate = normalizeDate(row.meeting_dates?.[0] ?? row.publish_date) ?? "無日期";
    const committee = asCommittee(analysis.committee_name) ?? "委員會";
    const title = asString(analysis.summary_title) ?? row.subject ?? row.agenda_id;

    for (const item of agendaItems) {
      if (!item || typeof item !== "object") continue;
      const speakers = (item as JsonObject).legislator_speakers;
      if (!Array.isArray(speakers)) continue;

      for (const speaker of speakers) {
        if (!speaker || typeof speaker !== "object") continue;
        const speakerObj = speaker as JsonObject;
        const rawName = asString(speakerObj.speaker_name) ?? "";
        if (!rawName) continue;

        // 統一格式化：完全去除 "立法委員"、"委員"、"立法" 及多餘空白
        const cleanName = rawName
          .replace(/\s*(立法委員|委員|立法)\s*/g, "")
          .replace(/\s+/g, "")
          .trim();
        if (!cleanName) continue;

        const viewpoints = Array.isArray(speakerObj.speaker_viewpoint)
          ? speakerObj.speaker_viewpoint.filter((v): v is string => typeof v === "string" && v.length > 0)
          : [];

        const nameKey = cleanName;
        const existing = legislatorMap.get(nameKey);

        const timelineEvent: LegislatorTimelineEvent = {
          agendaId: row.agenda_id,
          title,
          meetingDate,
          committee,
          viewpoints,
        };

        if (existing) {
          existing.speechCount += 1;
          existing.timeline.push(timelineEvent);
          if (meetingDate > existing.lastSpeechDate) {
            existing.lastSpeechDate = meetingDate;
            existing.lastAgendaId = row.agenda_id;
            existing.lastAgendaTitle = title;
          }
        } else {
          legislatorMap.set(nameKey, {
            name: cleanName,
            fullName: `${cleanName} 委員`,
            speechCount: 1,
            lastSpeechDate: meetingDate,
            lastAgendaId: row.agenda_id,
            lastAgendaTitle: title,
            timeline: [timelineEvent],
          });
        }
      }
    }
  }

  return Array.from(legislatorMap.values());
}
