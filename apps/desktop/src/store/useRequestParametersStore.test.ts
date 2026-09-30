import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, type AppSettings } from "@/lib/ipc";
import { testSettings } from "@/lib/test/settings";
import { useAppStore } from "./useAppStore";
import { useRequestParametersStore } from "./useRequestParametersStore";

beforeEach(() => {
  useRequestParametersStore.setState({ drafts: {}, savingProvider: null });
  useAppStore.setState({ settings: testSettings() });
});
afterEach(() => vi.restoreAllMocks());

describe("parameter draft saves", () => {
  it("does not publish an optimistic config and prevents duplicate submissions", async () => {
    let resolve!: (value: AppSettings) => void;
    const pending = new Promise<AppSettings>((done) => {
      resolve = done;
    });
    vi.spyOn(ipc, "saveRequestParameters").mockReturnValue(pending);
    const store = useRequestParametersStore.getState();
    store.sync("ollama", {});
    store.edit("ollama", '{"think":false}');
    const saving = store.save("ollama");
    expect(useRequestParametersStore.getState().savingProvider).toBe("ollama");
    expect(useAppStore.getState().settings?.providers[1]?.requestOverrides).toEqual({});
    await expect(store.save("ollama")).rejects.toThrow("already being saved");
    store.edit("ollama", "{}");
    expect(useRequestParametersStore.getState().drafts.ollama?.text).toBe('{"think":false}');
    const saved = testSettings();
    saved.speed = "detailed";
    saved.providers[1]!.model = "new-model";
    saved.providers[1]!.requestOverrides = { think: false };
    resolve(saved);
    await saving;
    expect(ipc.saveRequestParameters).toHaveBeenCalledOnce();
    expect(useAppStore.getState().settings).toEqual(saved);
    expect(useRequestParametersStore.getState().savingProvider).toBeNull();
  });
  it("updates clean drafts from background settings without replacing dirty ones", () => {
    const store = useRequestParametersStore.getState();
    store.sync("ollama", {});
    store.sync("gemini", {});
    store.edit("ollama", '{"think":false}');
    store.sync("ollama", { think: true });
    store.sync("gemini", { generationConfig: { temperature: 0.7 } });
    expect(useRequestParametersStore.getState().drafts.ollama?.text).toBe('{"think":false}');
    expect(useRequestParametersStore.getState().drafts.ollama?.saved).toContain('"think": true');
    const clean = useRequestParametersStore.getState().drafts.gemini;
    expect(clean?.text).toBe(clean?.saved);
    expect(clean?.text).toContain("generationConfig");
  });
});
