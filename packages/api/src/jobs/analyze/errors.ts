// 分類模型錯誤以決定重試或標記失敗
import { GeminiInputTooLargeError } from "@/gemini";

export function isTransientApiError(error: unknown): boolean {
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

export function isPermanentInputError(error: unknown): boolean {
  return error instanceof GeminiInputTooLargeError;
}
