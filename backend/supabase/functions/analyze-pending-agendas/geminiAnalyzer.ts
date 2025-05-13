// backend/supabase/functions/analyze-pending-agendas/geminiAnalyzer.ts
import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GenerationConfig,
  type SafetySetting,
  type Schema,
  Type,
  type Content,
} from "npm:@google/genai";
import type {
  AnalysisResultJson,
  GeminiErrorDetail,
} from "../_shared/types/analysis.ts"; // Ensure this path is correct
import { GEMINI_MODEL_NAME } from "./index.ts"; // Ensure this path is correct
import { JOB_NAME_ANALYZER } from "../_shared/utils.ts"; // Ensure this path is correct

// Define the speaker detail schema to be reused
const speakerDetailSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    speaker_name: {
      type: Type.STRING,
      nullable: true,
      description:
        "發言者姓名及其職稱/單位。例如：'黃國昌 立法委員' 或 '陳建仁 行政院院長' 或 '王美花 經濟部部長'。",
    },
    speaker_viewpoint: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
      description:
        "該發言者針對當前議程提出的具體論點、主要理由、建議、質詢、答覆或專業意見。避免程序性發言。若有多個獨立觀點，請作為陣列元素。",
    },
  },
  required: ["speaker_name"], // speaker_viewpoint can be null if no clear viewpoint
  propertyOrdering: ["speaker_name", "speaker_viewpoint"],
};

// Define the expected JSON response schema for Gemini
const analysisResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary_title: {
      type: Type.STRING,
      description: "代表全文核心焦點的高度概括性摘要標題 (50字內)。",
    },
    overall_summary_sentence: {
      type: Type.STRING,
      description:
        "整份議事記錄的主要內容、流程、法案全名或關鍵議題、以及重要結論的概括性總結，使讀者能快速理解會議核心 (約100-150字)。",
    },
    committee_name: {
      type: Type.ARRAY,
      nullable: true,
      description:
        "會議所屬的一個或多個委員會名稱陣列。單一委員會僅一個元素，聯席會議則包含所有相關委員會。請參考Prompt中提供的委員會列表和判斷邏輯。無法判斷則為 null 或空陣列。",
      items: {
        type: Type.STRING,
      },
    },
    agenda_items: {
      type: Type.ARRAY,
      nullable: true,
      description: "議事記錄中所有主要議程項目的詳細列表。",
      items: {
        type: Type.OBJECT,
        properties: {
          item_title: {
            type: Type.STRING,
            nullable: true,
            description:
              "議程項目的核心法案名稱與議程編號，例如 '某某法案修正草案 (討論事項第一案)'。請省略提案人姓名。",
          },
          core_issue: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "該議程項目詳細的核心問題、背景或主要討論內容，反映討論深度。若有多點，請作為陣列中的不同字串元素，確保每個元素論述完整。",
          },
          controversy: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "該議程項目主要的爭議點，包含不同意見的具體內容和理由。若有多點，作為陣列元素，確保描述清晰。無明顯爭議則為 null。",
          },
          legislator_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description:
              "主要質詢或提案的「立法委員」列表及其觀點。若無相關發言則為 null 或空陣列。",
            items: speakerDetailSchema,
          },
          respondent_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description:
              "主要答詢或報告的「政府官員」或「相關事業單位代表」或「專家學者」、「公民代表」、「產業代表」列表及其觀點/回應。若無相關發言則為 null 或空陣列。",
            items: speakerDetailSchema,
          },
          result_status_next: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "關於此議程的最終處理結果、審查進度或下一步行動的清晰且相對完整的說明，反映實際情況。若有多點，作為陣列元素。",
          },
        },
        required: ["item_title"],
        propertyOrdering: [
          "item_title",
          "core_issue",
          "controversy",
          "legislator_speakers", 
          "respondent_speakers", 
          "result_status_next",
        ],
      },
    },
  },
  required: [
    "summary_title",
    "overall_summary_sentence",
    "committee_name",
    "agenda_items",
  ],
  propertyOrdering: [
    "summary_title",
    "overall_summary_sentence",
    "committee_name",
    "agenda_items",
  ],
};

export async function analyzeWithGemini(
  fullPromptString: string,
  apiKey: string,
  _originalInputTextContent_for_logging_only: string, // Keep for potential future use in logging
  generationConfigParams: Partial<GenerationConfig> & {
    thinkingConfig?: { thinkingBudget?: number };
  },
  safetySettingsParams: SafetySetting[]
): Promise<AnalysisResultJson | GeminiErrorDetail> {
  const ai = new GoogleGenAI({ apiKey });

  const effectiveGenerationConfig: GenerationConfig = {
    ...(generationConfigParams as GenerationConfig),
    responseMimeType: "application/json",
    responseSchema: analysisResponseSchema,
  };

  const params: GenerateContentParameters = {
    model: GEMINI_MODEL_NAME,
    contents: [
      { role: "user", parts: [{ text: fullPromptString }] },
    ] as Content[], // Cast to Content[] to satisfy SDK, assuming single user message
    config: {
      // Renamed from 'generationConfig' to 'config' as per SDK changes for some models
      ...effectiveGenerationConfig,
      safetySettings: safetySettingsParams, // Ensure safetySettings is correctly placed
    },
  };

  console.log(
    `[${JOB_NAME_ANALYZER}-Gemini] Initializing Gemini client. Model: ${
      params.model
    }. Thinking Budget: ${
      (params.config as GenerationConfig)?.thinkingConfig?.thinkingBudget ??
      "Default/Off" // Accessing thinkingBudget
    }`
  );

  let rawResponseTextForError: string | undefined = undefined;

  try {
    console.log(
      `[${JOB_NAME_ANALYZER}-Gemini] Sending request to model ${params.model}...`
    );
    const result: GenerateContentResponse = await ai.models.generateContent(
      params
    );
    console.log(`[${JOB_NAME_ANALYZER}-Gemini] Received response from model.`);

    const usageMetadata = result.usageMetadata;
    if (usageMetadata) {
      console.log(
        `[${JOB_NAME_ANALYZER}-Gemini] Usage - Prompt Tokens: ${usageMetadata.promptTokenCount}, Candidates Tokens: ${usageMetadata.candidatesTokenCount}, Total Tokens: ${usageMetadata.totalTokenCount}`
      );
    } else {
      console.warn(
        `[${JOB_NAME_ANALYZER}-Gemini] Usage metadata not found in Gemini response.`
      );
    }

    const finishReason = result.candidates?.[0]?.finishReason;
    const safetyRatings =
      result.promptFeedback?.safetyRatings ||
      result.candidates?.[0]?.safetyRatings;
    console.log(
      `[${JOB_NAME_ANALYZER}-Gemini] Finish Reason: ${finishReason || "N/A"}`
    );
    if (safetyRatings && safetyRatings.length > 0) {
      console.log(
        `[${JOB_NAME_ANALYZER}-Gemini] Safety Ratings: ${JSON.stringify(
          safetyRatings
        )}`
      );
    }

    const candidate = result.candidates?.[0];
    if (
      !candidate ||
      !candidate.content ||
      !candidate.content.parts ||
      candidate.content.parts.length === 0
    ) {
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] Could not extract valid candidate content/parts from API response. Raw Response: ${JSON.stringify(
          result
        )}`
      );
      return {
        error:
          "Gemini API response structure incomplete or missing candidate content.",
        type: "MALFORMED_RESPONSE",
        rawOutput: JSON.stringify(result),
      };
    }

    const part = candidate.content.parts[0];
    if (!("text" in part && typeof part.text === "string")) {
      // Check if 'text' property exists and is a string
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] Response part does not contain identifiable text. Part Content: ${JSON.stringify(
          part
        )}. Raw Response: ${JSON.stringify(result)}`
      );
      return {
        error:
          "Gemini response part lacks valid text content for JSON parsing.",
        type: "EMPTY_RESPONSE_PART",
        rawOutput: JSON.stringify(result),
      };
    }

    rawResponseTextForError = part.text;

    if (finishReason === "MAX_TOKENS") {
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] CRITICAL: Output truncated due to MAX_TOKENS limit.`
      );
      return {
        error: `AI output truncated (MAX_TOKENS). Candidate Tokens: ${
          usageMetadata?.candidatesTokenCount || "N/A"
        }`,
        type: "MAX_TOKENS",
        rawOutput: rawResponseTextForError,
      };
    }
    if (finishReason === "SAFETY") {
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] CRITICAL: Output stopped due to safety settings.`
      );
      return {
        error: `AI output terminated by safety settings (SAFETY). Ratings: ${JSON.stringify(
          safetyRatings || []
        )}`,
        type: "SAFETY",
        rawOutput: rawResponseTextForError,
      };
    }
    if (finishReason === "OTHER") {
      // Handle "OTHER" which can indicate schema issues
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] CRITICAL: Output stopped for OTHER reason (possibly schema related). Raw Response: ${rawResponseTextForError}`
      );
      return {
        error: `AI output terminated (OTHER reason). May indicate responseSchema incompatibility.`,
        type: "SCHEMA_ERROR_OR_OTHER",
        rawOutput: rawResponseTextForError,
      };
    }
    // Allow "STOP" or undefined/null as valid finish reasons for JSON mode if content is present
    if (
      finishReason !== "STOP" &&
      finishReason !== undefined &&
      finishReason !== null
    ) {
      console.warn(
        `[${JOB_NAME_ANALYZER}-Gemini] Unusual finish reason: '${finishReason}'. Attempting JSON parse. Raw Response: ${rawResponseTextForError}`
      );
      // Potentially return error if this is unexpected for JSON mode.
      // For now, proceed to parse if text is available.
    }

    let textToParse = part.text;
    const markdownBlockRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
    const match = textToParse.trim().match(markdownBlockRegex);
    if (match && match[1]) {
      textToParse = match[1].trim();
      console.log(
        `[${JOB_NAME_ANALYZER}-Gemini] Removed Markdown JSON wrapper from AI response.`
      );
    } else if (
      textToParse.trim().startsWith("```") ||
      textToParse.trim().endsWith("```")
    ) {
      let tempText = textToParse.trim();
      if (tempText.startsWith("```json")) {
        tempText = tempText.substring(7);
      } else if (tempText.startsWith("```")) {
        tempText = tempText.substring(3);
      }
      if (tempText.endsWith("```")) {
        tempText = tempText.substring(0, tempText.length - 3);
      }
      textToParse = tempText.trim();
      if (textToParse !== part.text.trim()) {
        console.log(
          `[${JOB_NAME_ANALYZER}-Gemini] Attempted lenient cleanup of Markdown wrappers.`
        );
      }
    }

    console.log(
      `[${JOB_NAME_ANALYZER}-Gemini] Attempting to parse JSON from AI response...`
    );
    const parsedJson = JSON.parse(textToParse); // textToParse should be a string here
    const jsonResult = parsedJson as AnalysisResultJson;

    // Basic client-side validation of the parsed JSON structure
    if (
      jsonResult &&
      typeof jsonResult === "object" &&
      typeof jsonResult.summary_title === "string" &&
      typeof jsonResult.overall_summary_sentence === "string" &&
      (jsonResult.committee_name === null ||
        Array.isArray(jsonResult.committee_name)) && // committee_name is array or null
      (jsonResult.agenda_items === null ||
        Array.isArray(jsonResult.agenda_items))
    ) {
      if (jsonResult.committee_name && jsonResult.committee_name.length > 0) {
        if (
          !jsonResult.committee_name.every((name) => typeof name === "string")
        ) {
          console.warn(
            `[${JOB_NAME_ANALYZER}-Gemini] Parsed JSON failed client-side validation: committee_name array contains non-string elements. Parsed Object: ${JSON.stringify(
              jsonResult
            )}`
          );
          return {
            error:
              "Parsed JSON from AI failed: committee_name array elements are not all strings.",
            type: "INVALID_STRUCTURE_POST_SCHEMA",
            rawOutput: rawResponseTextForError,
            parsedResult: jsonResult,
          };
        }
      }
      console.log(
        `[${JOB_NAME_ANALYZER}-Gemini] Analysis successful: JSON parsed and basic structure validated.`
      );
      return jsonResult;
    } else {
      console.warn(
        `[${JOB_NAME_ANALYZER}-Gemini] Parsed JSON failed client-side structure validation. Parsed Object: ${JSON.stringify(
          jsonResult
        )}`
      );
      return {
        error: "Parsed JSON from AI failed client-side structure validation.",
        type: "INVALID_STRUCTURE_POST_SCHEMA",
        rawOutput: rawResponseTextForError, // Use the stored raw text
        parsedResult: jsonResult,
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_ANALYZER}-Gemini] Error during API call or JSON parsing:`,
      error
    );

    let errorMessage = `Gemini API call or JSON parsing failed: ${errorMsg}`;
    let errorType: GeminiErrorDetail["type"] = "API_CALL_OR_PARSE_ERROR"; // Default

    if (
      error instanceof SyntaxError || // JSON.parse error
      errorMsg.toLowerCase().includes("json") // Other JSON related errors
    ) {
      errorMessage = `Failed to parse API response as JSON: ${errorMsg}`;
      errorType = "JSON_PARSE_ERROR_WITH_SCHEMA";
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] Text that failed JSON parsing (first 500 chars): ${
          rawResponseTextForError?.substring(0, 500) ?? "N/A"
        }`
      );
    } else if (
      errorMsg.includes("SCHEMA_ERROR") || // Specific schema error strings
      (errorMsg.includes("InvalidArgument") &&
        errorMsg.includes("response_schema"))
    ) {
      errorMessage = `Gemini API call failed, possibly responseSchema related: ${errorMsg}`;
      errorType = "SCHEMA_ERROR_OR_OTHER";
    } else if (errorMsg.includes("SAFETY")) {
      errorMessage = `Content/response triggered Gemini safety rules: ${errorMsg}`;
      errorType = "SAFETY";
    } else if (
      errorMsg.includes("fetch failed") || // General network errors
      (error instanceof Error &&
        "cause" in error &&
        typeof error.cause === "object" &&
        error.cause !== null &&
        "code" in error.cause &&
        (error.cause.code === "ENOTFOUND" ||
          error.cause.code === "ECONNREFUSED")) // Deno specific network error codes
    ) {
      errorMessage = `Network error connecting to Gemini API: ${errorMsg}`;
      errorType = "NETWORK_ERROR";
    } else if (errorMsg.includes("API key not valid")) {
      errorMessage = `Invalid Gemini API Key: ${errorMsg}`;
      errorType = "AUTH_ERROR";
    } else if (
      errorMsg.includes("Deadline exceeded") || // Timeout errors
      errorMsg.includes("timeout")
    ) {
      errorMessage = `Gemini API call timed out: ${errorMsg}`;
      errorType = "TIMEOUT_ERROR";
    } else if (error instanceof Response && !error.ok) {
      // HTTP errors
      errorMessage = `Gemini API HTTP error ${error.status}: ${
        error.statusText
      }. Details: ${await error
        .text()
        .catch(() => "(Could not read error body)")}`;
      errorType = "HTTP_ERROR";
    } else if (errorMsg.includes("[GoogleGenerativeAI Error]")) {
      // SDK specific errors
      if (
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("resource_exhausted")
      ) {
        errorType = "QUOTA_EXCEEDED";
        errorMessage = `Gemini API quota/rate limit issue: ${errorMsg}`;
      } else if (errorMsg.toLowerCase().includes("invalid_argument")) {
        errorType = "INVALID_ARGUMENT";
        errorMessage = `Invalid argument to Gemini API: ${errorMsg}`;
      } else {
        errorType = "GOOGLE_AI_ERROR"; // Generic Google AI SDK error
      }
    }

    return {
      error: errorMessage,
      type: errorType,
      rawOutput: rawResponseTextForError, // Include raw text if available
    };
  }
}
