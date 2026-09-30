import type { JsonValue, ProviderId } from "./ipc";

export const PARAMETER_PLACEHOLDERS: Record<ProviderId, string> = {
  openAiCompatible: '{\n  "temperature": 0.7,\n  "top_p": 0.9,\n  "max_tokens": 2048\n}',
  ollama:
    '{\n  "think": false,\n  "options": {\n    "temperature": 0.7,\n    "num_predict": 2048\n  }\n}',
  gemini:
    '{\n  "generationConfig": {\n    "temperature": 0.7,\n    "topP": 0.9,\n    "maxOutputTokens": 2048\n  }\n}',
};

export const PARAMETER_PATHS: Record<ProviderId, string> = {
  openAiCompatible: "temperature and max_tokens",
  ollama: "options.temperature and options.num_predict",
  gemini: "generationConfig.temperature and generationConfig.maxOutputTokens",
};

export function parameterText(value: JsonValue): string {
  return isObject(value) && Object.keys(value).length === 0 ? "" : JSON.stringify(value, null, 2);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Fast local feedback only. Rust validates raw drafts, duplicates and provider
// fields authoritatively; never submit a JSON.parse result instead of the draft.
export function basicParameterError(draft: string): string | null {
  if (new TextEncoder().encode(draft).length > 64 * 1024)
    return "Use at most 64 KiB of UTF-8 JSON.";
  if (!draft.trim()) return null;
  try {
    const value: unknown = JSON.parse(draft);
    if (!isObject(value)) return "Request parameters must be a JSON object.";
    return treeError(value, 0);
  } catch {
    return "Invalid JSON. Use an object without comments or trailing commas.";
  }
}

function treeError(value: unknown, depth: number): string | null {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
  ) {
    return "Integers must be within JavaScript's safe integer range; numbers must be finite.";
  }
  if (Array.isArray(value) || isObject(value)) {
    if (depth >= 16) return "Nesting exceeds 16 levels.";
    for (const child of Object.values(value)) {
      const error = treeError(child, depth + 1);
      if (error) return error;
    }
  }
  return null;
}

export function parameterErrorMessage(error: unknown): string {
  if (isObject(error) && typeof error.message === "string") {
    const path = typeof error.path === "string" ? `${error.path}: ` : "";
    const location =
      typeof error.line === "number" && typeof error.column === "number"
        ? ` (line ${error.line}, column ${error.column})`
        : "";
    return `${path}${error.message}${location}`;
  }
  return error instanceof Error ? error.message : "Could not validate or save request parameters.";
}
