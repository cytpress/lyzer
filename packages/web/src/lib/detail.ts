// 共用公報詳細頁的文字整理與目錄識別規則
import type { AnalysisAgendaItem, SpeakerDetail } from "@/types";

export function asArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export function itemTitle(item: AnalysisAgendaItem): string {
  return item.item_title ?? item.title ?? "未命名議程";
}

export function speakerName(speaker: SpeakerDetail): string {
  return speaker.speaker_name ?? "未標示發言者";
}

export function itemNumber(index: number): string {
  const chineseNumbers = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return chineseNumbers[index] ?? String(index + 1);
}

export function speakerId(itemIndex: number, role: "legislator" | "respondent", speakerIndex: number): string {
  return `item-${itemIndex}-${role}-speaker-${speakerIndex}`;
}
