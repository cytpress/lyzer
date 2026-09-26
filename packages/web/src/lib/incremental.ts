import { createHash } from "node:crypto";

/** Create a stable key from the data used to render one prerendered page. */
export function createPageCacheKey(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Astro incremental build cache data must be JSON serializable");
  }

  return createHash("sha256").update(serialized).digest("hex");
}
