import { describe, expect, it } from "vitest";
import { basicParameterError, parameterText, PARAMETER_PLACEHOLDERS } from "./requestParameters";

describe("request parameter drafts", () => {
  it("shows empty overrides as a blank editor without inserting examples", () => {
    expect(parameterText({})).toBe("");
    expect(basicParameterError(" \n ")).toBeNull();
    for (const placeholder of Object.values(PARAMETER_PLACEHOLDERS)) {
      expect(basicParameterError(placeholder)).toBeNull();
    }
  });
  it("uses actual provider-specific body nesting", () => {
    const ollama: unknown = JSON.parse(PARAMETER_PLACEHOLDERS.ollama);
    const gemini: unknown = JSON.parse(PARAMETER_PLACEHOLDERS.gemini);
    expect(ollama).toEqual({
      think: false,
      options: { temperature: 0.7, num_predict: 2048 },
    });
    expect(gemini).toEqual({
      generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 },
    });
  });
  it("catches syntax, root shape, UTF-8 size and unsafe integers locally", () => {
    for (const draft of [
      "[]",
      "null",
      "{} trailing",
      '{"x":1,}',
      '{"x":9007199254740992}',
      JSON.stringify({ x: "文".repeat(22_000) }),
    ]) {
      expect(basicParameterError(draft)).not.toBeNull();
    }
  });
  it("uses the same 16-container depth limit as Rust", () => {
    const valid = '{"x":'.repeat(16) + "0" + "}".repeat(16);
    expect(basicParameterError(valid)).toBeNull();
    expect(basicParameterError('{"x":' + valid + "}")).not.toBeNull();
  });
  it("pretty formatting preserves string whitespace and JSON value types", () => {
    const value = { note: "a  b\nc 日本語", custom: [false, 0, null] };
    const parsed: unknown = JSON.parse(parameterText(value));
    expect(parsed).toEqual(value);
  });
});
