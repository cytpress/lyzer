import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { analysisSchema, buildAnalysisPrompt } from "./prompts.js";
import type { JsonObject } from "./types.js";

interface AnalyzeInput {
  agendaId: string;
  subject: string | null;
  meetingDates: string[];
  sourceText: string;
}

export async function analyzeWithGemini(input: AnalyzeInput): Promise<JsonObject> {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required for analysis");
  }

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const response = await ai.models.generateContent({
    model: config.geminiModelName,
    contents: buildAnalysisPrompt(input),
    config: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: analysisSchema,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return JSON.parse(text) as JsonObject;
}
