import { extractProcessedUrls } from "./lyapiClient.js";
import type { JsonObject } from "./types.js";

interface AgendaForContent {
  agenda_id: string;
  parsed_url: string | null;
  txt_url: string | null;
  raw: JsonObject;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function parsedBlocksToText(payload: unknown): string {
  const data = asObject(payload);
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const blockLines = Array.isArray(data.block_lines) ? data.block_lines : [];

  return blocks
    .map((block, index) => {
      const lines = Array.isArray(block)
        ? block
            .filter((line): line is string => typeof line === "string")
            .map(cleanLine)
            .filter(Boolean)
        : [];
      if (lines.length === 0) return "";

      const lineNumber = typeof blockLines[index] === "number" ? blockLines[index] : null;
      const prefix = lineNumber ? `[line ${lineNumber}] ` : "";
      return `${prefix}${lines.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "LyzerBot (+https://github.com/cytpress/lyzer)",
    },
  });
  if (!response.ok) {
    throw new Error(`source fetch failed ${response.status}: ${url}`);
  }
  return response.text();
}

async function fetchParsed(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "LyzerBot (+https://github.com/cytpress/lyzer)",
    },
  });
  if (!response.ok) {
    throw new Error(`parsed fetch failed ${response.status}: ${url}`);
  }
  const payload = await response.json();
  return parsedBlocksToText(payload);
}

function uniqueUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.filter(Boolean)));
}

export async function loadAgendaText(agenda: AgendaForContent): Promise<string> {
  const parsedUrls = uniqueUrls([
    ...extractProcessedUrls(agenda.raw, "parsed").map((item) => item.url),
    agenda.parsed_url ?? "",
  ]);

  const parsedTexts: string[] = [];
  for (const [index, url] of parsedUrls.entries()) {
    try {
      const text = await fetchParsed(url);
      parsedTexts.push(`[parsed document ${index + 1}]\n${text}`);
    } catch (error) {
      console.warn(error);
    }
  }

  if (parsedTexts.length > 0) {
    return parsedTexts.join("\n\n");
  }

  const txtUrls = uniqueUrls([
    ...extractProcessedUrls(agenda.raw, "txt").map((item) => item.url),
    agenda.txt_url ?? "",
  ]);
  const txtTexts: string[] = [];
  for (const [index, url] of txtUrls.entries()) {
    const text = await fetchText(url);
    txtTexts.push(`[text document ${index + 1}]\n${text}`);
  }

  if (txtTexts.length === 0) {
    throw new Error(`agenda ${agenda.agenda_id} has no parsed_url or txt_url`);
  }

  return txtTexts.join("\n\n");
}
