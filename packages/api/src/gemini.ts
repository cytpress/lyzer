import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { analysisSchema, buildAnalysisPrompt } from "./prompts.js";
import type { JsonObject } from "./types.js";

interface AnalyzeInput {
  categoryCode: number;
  sourceText: string;
}

const TOKEN_COUNT_CHECK_THRESHOLD = 200_000;
const MAX_INPUT_TOKENS = 240_000;

export class GeminiInputTooLargeError extends Error {
  constructor(totalTokens: number) {
    super(`Gemini input is too large: ${totalTokens} tokens exceeds the ${MAX_INPUT_TOKENS} token safety limit`);
    this.name = "GeminiInputTooLargeError";
  }
}

export async function analyzeWithGemini(input: AnalyzeInput): Promise<JsonObject> {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required for analysis");
  }

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const contents = buildAnalysisPrompt({
    categoryCode: input.categoryCode,
    sourceText: input.sourceText,
  });

  if (input.sourceText.length >= TOKEN_COUNT_CHECK_THRESHOLD) {
    const tokenCount = await ai.models.countTokens({
      model: config.geminiModelName,
      contents,
    });
    if ((tokenCount.totalTokens ?? 0) > MAX_INPUT_TOKENS) {
      throw new GeminiInputTooLargeError(tokenCount.totalTokens ?? 0);
    }
  }

  const response = await ai.models.generateContent({
    model: config.geminiModelName,
    contents,
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
