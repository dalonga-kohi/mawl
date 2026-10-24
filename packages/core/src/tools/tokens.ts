/**
 * Rough token count: characters over four, rounded up. Good enough to decide when an output is too
 * large for context; no tokenizer dependency (decided for D2.2).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Tool outputs above this many (estimated) tokens are stored as artifacts (MEMORY §5, L0). */
export const ARTIFACT_THRESHOLD_TOKENS = 4000

/** Characters of a large output the model sees inline, next to the artifact id. */
export const ARTIFACT_PREVIEW_CHARS = 2000

/** Characters of raw output carried by the `run.tool_result` event. */
export const EVENT_PREVIEW_CHARS = 300
