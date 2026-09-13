# LyAPI rate-limit handling design

## Goal

Make scheduled LyAPI fetches reliable when the upstream API rate-limits burst traffic. The current fetch walks gazettes sequentially but has no delay or retry, so one HTTP 429 aborts the job.

## Design

`packages/api/src/lyapiClient.ts` will own LyAPI request pacing and retry behavior:

- All LyAPI GET requests share a process-local request gate.
- A successful request reserves the next request slot at least 1,000 ms later.
- HTTP 429 is retried up to three times. If `Retry-After` is present, use its seconds or HTTP-date value; otherwise use 30 seconds, 60 seconds, and 120 seconds for successive retries.
- Other HTTP errors remain immediate failures. After retries are exhausted, the error includes the status, URL, and retry count.
- The behavior applies to both gazette-list and agenda-list requests, including agenda pagination.

## Testing

- Add focused unit-level coverage for request spacing, `Retry-After`, fallback backoff, and retry exhaustion using mocked `fetch` and timers where the repository's existing test setup allows.
- Run the API typecheck/build and the repository's available checks.
- Rebuild the remote API container and perform one controlled fetch verification after deployment.

## Scope

This change does not alter `FETCH_PAGES`, database behavior, scheduler frequency, or LyAPI payloads. It does not retry other 4xx responses.
