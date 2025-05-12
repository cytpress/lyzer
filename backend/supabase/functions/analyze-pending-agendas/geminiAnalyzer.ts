import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GenerationConfig,
  type SafetySetting,
  type Schema,
  Type,
  type Content,
  // Potentially needed for detailed error checking:
  // GoogleGenerativeAIResponseError, // Uncomment if used for error instanceof checks
} from "npm:@google/genai";
import type {
  AnalysisResultJson,
  GeminiErrorDetail,
} from "../_shared/types/analysis.ts";
import { GEMINI_MODEL_NAME } from "./index.ts"; // Import model name from local index
import { JOB_NAME_ANALYZER } from "../_shared/utils.ts"; // Import job name for logging

// --- Define the expected JSON response schema for Gemini ---
// This schema is used by the Gemini API to structure its JSON output.
// The 'description' fields are crucial for the API and MUST remain in Traditional Chinese.
const analysisResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary_title: {
      type: Type.STRING,
      description: "會議或記錄的核心主題摘要標題 (50字內)",
    },
    overall_summary_sentence: {
      type: Type.STRING,
      description: "整份議事記錄的主要內容、流程和重要結論概括 (約100-150字)",
    },
    committee_name: {
      type: Type.STRING,
      nullable: true,
      description: "會議所屬的委員會名稱，無法判斷則為 null",
    },
    agenda_items: {
      type: Type.ARRAY,
      nullable: true,
      description: "議程項目列表",
      items: {
        type: Type.OBJECT,
        properties: {
          item_title: {
            type: Type.STRING,
            nullable: true,
            description: "議程項目的標題或案由",
          },
          core_issue: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "核心問題或討論內容。若有多點，請作為陣列中的不同字串元素。",
          },
          controversy: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "主要爭議點。若有多點，請作為陣列中的不同字串元素。無爭議則為 null。",
          },
          key_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description: "主要發言者列表",
            items: {
              type: Type.OBJECT,
              properties: {
                speaker_name: {
                  type: Type.STRING,
                  nullable: true,
                  description: "發言者姓名或職稱",
                },
                speaker_viewpoint: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  nullable: true,
                  description:
                    "主要觀點或立場。若有多點，請作為陣列中的不同字串元素。",
                },
              },
              required: ["speaker_name"],
              propertyOrdering: ["speaker_name", "speaker_viewpoint"],
            },
          },
          result_status_next: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "處理結果或下一步行動。若有多點，請作為陣列中的不同字串元素。",
          },
        },
        required: ["item_title"],
        propertyOrdering: [
          "item_title",
          "core_issue",
          "controversy",
          "key_speakers",
          "result_status_next",
        ],
      },
    },
  },
  required: ["summary_title", "overall_summary_sentence", "agenda_items"],
  propertyOrdering: [
    "summary_title",
    "overall_summary_sentence",
    "committee_name",
    "agenda_items",
  ],
};

/**
 * Analyzes text content using the Gemini API with a predefined JSON schema.
 * It prepares the request, calls the API, and processes the response,
 * handling various success and error conditions.
 * @param fullPromptString The complete prompt to send to the Gemini API.
 * @param apiKey The API key for accessing the Gemini service.
 * @param _originalInputTextContent_for_logging_only The original text content (currently unused in this function's logic but available).
 * @param generationConfigParams Configuration for the Gemini model's generation process.
 * @param safetySettingsParams Safety settings to apply to the Gemini model's response.
 * @returns A promise that resolves to either the successfully parsed `AnalysisResultJson`
 *          or a `GeminiErrorDetail` object if an error occurs.
 */
export async function analyzeWithGemini(
  fullPromptString: string,
  apiKey: string,
  _originalInputTextContent_for_logging_only: string,
  generationConfigParams: Partial<GenerationConfig> & {
    thinkingConfig?: { thinkingBudget?: number };
  },
  safetySettingsParams: SafetySetting[]
): Promise<AnalysisResultJson | GeminiErrorDetail> {
  const ai = new GoogleGenAI({ apiKey }); // Initialize Gemini client

  // Combine provided generation config with required schema settings
  const effectiveGenerationConfig: GenerationConfig = {
    ...(generationConfigParams as GenerationConfig),
    responseMimeType: "application/json", // Request JSON output
    responseSchema: analysisResponseSchema, // Enforce the defined schema (with Chinese descriptions)
  };

  // Prepare parameters for the API call according to the confirmed SDK structure
  const params: GenerateContentParameters = {
    model: GEMINI_MODEL_NAME,
    contents: [
      { role: "user", parts: [{ text: fullPromptString }] },
    ] as Content[],
    config: {
      ...effectiveGenerationConfig,
      safetySettings: safetySettingsParams,
    },
  };

  console.log(
    `[${JOB_NAME_ANALYZER}-Gemini] Initializing Gemini client. Model: ${
      params.model // Log model being used
    }. Thinking Budget: ${
      params.config?.thinkingConfig?.thinkingBudget ?? "Default/Off"
    }`
  );

  let rawResponseTextForError: string | undefined = undefined; // To store raw AI output for error diagnosis

  try {
    // Call the Gemini API using the `ai.models.generateContent(params)` pattern
    console.log(
      `[${JOB_NAME_ANALYZER}-Gemini] Sending request to model ${params.model}...`
    );
    const result: GenerateContentResponse = await ai.models.generateContent(
      params
    );
    console.log(`[${JOB_NAME_ANALYZER}-Gemini] Received response from model.`);

    // Process API response metadata
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

    // Extract and validate content from the response
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

    rawResponseTextForError = part.text; // Store for potential error reporting

    // Handle non-STOP finish reasons which indicate potential issues
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
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] CRITICAL: Output stopped for OTHER reason (possibly schema related).`
      );
      return {
        error: `AI output terminated (OTHER reason). May indicate responseSchema incompatibility.`,
        type: "SCHEMA_ERROR_OR_OTHER",
        rawOutput: rawResponseTextForError,
      };
    }
    if (
      finishReason !== "STOP" &&
      finishReason !== undefined &&
      finishReason !== null
    ) {
      // null can also be a valid stop
      console.warn(
        `[${JOB_NAME_ANALYZER}-Gemini] Unusual finish reason: '${finishReason}'. Attempting JSON parse.`
      );
    }

    // Clean potential Markdown code block wrappers from the JSON string
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
      // Lenient cleanup if regex fails but backticks are present
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

    // Parse the cleaned text as JSON
    console.log(
      `[${JOB_NAME_ANALYZER}-Gemini] Attempting to parse JSON from AI response...`
    );
    const parsedJson = JSON.parse(textToParse);
    const jsonResult = parsedJson as AnalysisResultJson;

    // Basic client-side validation of the parsed JSON structure
    if (
      jsonResult &&
      typeof jsonResult === "object" &&
      typeof jsonResult.summary_title === "string" &&
      typeof jsonResult.overall_summary_sentence === "string" &&
      (jsonResult.agenda_items === null ||
        Array.isArray(jsonResult.agenda_items))
    ) {
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
        rawOutput: rawResponseTextForError,
        parsedResult: jsonResult, // Include the problematic parsed object
      };
    }
  } catch (error) {
    // Handle errors from API call or JSON parsing
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_ANALYZER}-Gemini] Error during API call or JSON parsing:`,
      error
    );

    let errorMessage = `Gemini API call or JSON parsing failed: ${errorMsg}`;
    let errorType = "API_CALL_OR_PARSE_ERROR"; // Default

    // Refine error type based on error details
    if (
      error instanceof SyntaxError ||
      errorMsg.toLowerCase().includes("json")
    ) {
      errorMessage = `Failed to parse API response as JSON: ${errorMsg}`;
      errorType = "JSON_PARSE_ERROR_WITH_SCHEMA";
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] Text that failed JSON parsing (first 500 chars): ${
          rawResponseTextForError?.substring(0, 500) ?? "N/A"
        }`
      );
    } else if (
      errorMsg.includes("SCHEMA_ERROR") ||
      (errorMsg.includes("InvalidArgument") &&
        errorMsg.includes("response_schema"))
    ) {
      errorMessage = `Gemini API call failed, possibly responseSchema related: ${errorMsg}`;
      errorType = "SCHEMA_ERROR_OR_OTHER";
    } else if (errorMsg.includes("SAFETY")) {
      errorMessage = `Content/response triggered Gemini safety rules: ${errorMsg}`;
      errorType = "SAFETY";
    } else if (
      errorMsg.includes("fetch failed") ||
      (error instanceof Error &&
        "code" in error &&
        (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED"))
    ) {
      errorMessage = `Network error connecting to Gemini API: ${errorMsg}`;
      errorType = "NETWORK_ERROR";
    } else if (errorMsg.includes("API key not valid")) {
      errorMessage = `Invalid Gemini API Key: ${errorMsg}`;
      errorType = "AUTH_ERROR";
    } else if (
      errorMsg.includes("Deadline exceeded") ||
      errorMsg.includes("timeout")
    ) {
      errorMessage = `Gemini API call timed out: ${errorMsg}`;
      errorType = "TIMEOUT_ERROR";
    } else if (error instanceof Response && !error.ok) {
      errorMessage = `Gemini API HTTP error ${error.status}: ${
        error.statusText
      }. Details: ${await error
        .text()
        .catch(() => "(Could not read error body)")}`;
      errorType = "HTTP_ERROR";
    } else if (errorMsg.includes("[GoogleGenerativeAI Error]")) {
      // Check for Google SDK specific errors
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
      rawOutput: rawResponseTextForError,
    };
  }
}
