import { fetchWithRetry, JOB_NAME_ANALYZER } from "../_shared/utils.ts";

/**
 * Fetches and prepares content text from a URL, handling timeouts and truncation.
 * @param url The URL to fetch content from.
 * @param maxLength Maximum allowed character length for the content; longer content will be truncated.
 * @param timeoutMs Timeout duration for the fetch operation in milliseconds.
 * @param fetchJobName Identifier used in logs for the `fetchWithRetry` utility.
 * @returns A promise resolving to an object containing:
 *          `text`: The fetched text content (or null if an error occurred).
 *          `truncated`: A boolean indicating if the content was truncated.
 *          `error`: An Error object if fetching or preparation failed, otherwise undefined.
 */
export async function fetchAndPrepareContent(
  url: string,
  maxLength: number,
  timeoutMs: number,
  fetchJobName: string = `${JOB_NAME_ANALYZER}-contentFetch` // Default job name for logs
): Promise<{ text: string | null; truncated: boolean; error?: Error }> {
  let contentText: string | null = null;
  let truncated = false;
  let fetchError: Error | undefined;

  try {
    console.log(
      `[${fetchJobName}] Fetching content from: ${url} (Timeout: ${timeoutMs}ms)`
    );
    const controller = new AbortController(); // For implementing timeout
    const timeoutId = setTimeout(() => {
      console.warn(`[${fetchJobName}] Fetch timeout triggered for URL: ${url}`);
      controller.abort();
    }, timeoutMs);

    // Use the shared fetchWithRetry utility
    const contentResponse = await fetchWithRetry(
      url,
      { signal: controller.signal }, // Pass the abort signal
      2, // Retry count for content fetching (consider making this a shared constant)
      fetchJobName
    );
    clearTimeout(timeoutId); // Important: clear the timeout if fetch completes/errors before it fires

    contentText = await contentResponse.text();

    // Truncate content if it exceeds the specified maximum length
    if (contentText.length > maxLength) {
      console.warn(
        `[${fetchJobName}] Content too long, truncating (URL: ${url}, Length: ${contentText.length} > Limit: ${maxLength}).`
      );
      contentText = contentText.substring(0, maxLength);
      truncated = true;
    }

    // Check for empty or whitespace-only content after potential truncation
    if (!contentText || contentText.trim().length === 0) {
      throw new Error("Fetched content is empty or contains only whitespace.");
    }

    // Log success
    console.log(
      `[${fetchJobName}] Successfully fetched and prepared content (URL: ${url}) (Size: ${(
        contentText.length / 1024
      ).toFixed(1)} KB)${truncated ? " [TRUNCATED]" : ""}.`
    );
  } catch (error) {
    // Catch errors from fetchWithRetry or the empty content check
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[${fetchJobName}] Error fetching or preparing content (URL: ${url}): ${errorMessage}`
    );
    fetchError = error instanceof Error ? error : new Error(errorMessage); // Ensure it's an Error object
    contentText = null; // Ensure text is null on error to signal failure clearly
  }

  return { text: contentText, truncated, error: fetchError };
}
