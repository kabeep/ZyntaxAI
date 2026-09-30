import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, type JsonValue } from "@/lib/ipc";
import { testSettings } from "@/lib/test/settings";
import { useAppStore } from "@/store/useAppStore";
import { useRequestParametersStore } from "@/store/useRequestParametersStore";
import { RequestParametersEditor } from "./RequestParametersEditor";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useAppStore.setState({ settings: testSettings(), saveError: null });
  useRequestParametersStore.setState({ drafts: {}, savingProvider: null });
  vi.spyOn(ipc, "validateRequestParameters").mockImplementation(async (_provider, draft) => {
    const value: JsonValue = draft.trim() ? (JSON.parse(draft) as JsonValue) : {};
    return value;
  });
  vi.spyOn(ipc, "saveRequestParameters").mockImplementation(async (provider, draft) => {
    const settings = useAppStore.getState().settings ?? testSettings();
    const value = await ipc.validateRequestParameters(provider, draft);
    return {
      ...settings,
      providers: settings.providers.map((profile) =>
        profile.id === provider ? { ...profile, requestOverrides: value } : profile,
      ),
    };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openEditor() {
  const details = screen.getByText("Edit JSON parameters").closest("details");
  act(() => details?.setAttribute("open", ""));
  return screen.getByLabelText<HTMLTextAreaElement>("Custom JSON parameters");
}
function saveButton() {
  return screen.getByRole<HTMLButtonElement>("button", { name: /^Save$/ });
}
async function readyToSave() {
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

describe("request parameters editor", () => {
  it("starts folded and blank, exposes examples only as placeholders", async () => {
    render(<RequestParametersEditor provider="ollama" />);
    expect(screen.getByText("Edit JSON parameters").closest("details")?.hasAttribute("open")).toBe(
      false,
    );
    const input = openEditor();
    expect(input.value).toBe("");
    expect(input.placeholder).toContain('"options"');
    await waitFor(() => expect(ipc.validateRequestParameters).toHaveBeenCalledWith("ollama", ""));
    expect(ipc.saveRequestParameters).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);
  });

  it("formats without saving and sends the raw draft only after Save", async () => {
    render(<RequestParametersEditor provider="openAiCompatible" />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: '{"temperature":0.7}' } });
    await readyToSave();
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    await waitFor(() => expect(input.value).toBe('{\n  "temperature": 0.7\n}'));
    expect(ipc.saveRequestParameters).not.toHaveBeenCalled();
    await readyToSave();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(ipc.saveRequestParameters).toHaveBeenCalledWith(
        "openAiCompatible",
        '{\n  "temperature": 0.7\n}',
      ),
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
  });

  it("keeps saved parameters until a cleared draft is explicitly saved", async () => {
    const settings = testSettings();
    settings.providers[0]!.requestOverrides = { temperature: 0.7 };
    useAppStore.setState({ settings });
    render(<RequestParametersEditor provider="openAiCompatible" />);
    const input = openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(input.value).toBe("");
    expect(useAppStore.getState().settings?.providers[0]?.requestOverrides).toEqual({
      temperature: 0.7,
    });
    await readyToSave();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(useAppStore.getState().settings?.providers[0]?.requestOverrides).toEqual({}),
    );
  });

  it("shows local syntax errors and backend duplicate-key errors without saving", async () => {
    render(<RequestParametersEditor provider="openAiCompatible" />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: "[]" } });
    expect(screen.getByRole("alert").textContent).toContain("JSON object");
    expect(saveButton().disabled).toBe(true);
    vi.mocked(ipc.validateRequestParameters).mockRejectedValue({
      path: "$",
      message: "Duplicate key at $.temperature",
      line: 1,
      column: 32,
    });
    fireEvent.change(input, {
      target: { value: '{"temperature":1,"temperature":2}' },
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Duplicate key"));
    expect(saveButton().disabled).toBe(true);
    expect(ipc.saveRequestParameters).not.toHaveBeenCalled();
  });

  it("preserves drafts on save failure and permits retry", async () => {
    vi.mocked(ipc.saveRequestParameters).mockRejectedValueOnce({
      code: "settings_write",
      message: "Cannot write settings",
      remedy: "Check permissions",
      retryable: false,
    });
    render(<RequestParametersEditor provider="openAiCompatible" />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: '{"temperature":0.7}' } });
    await readyToSave();
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Cannot write"));
    expect(input.value).toBe('{"temperature":0.7}');
    expect(useAppStore.getState().settings?.providers[0]?.requestOverrides).toEqual({});
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
  });

  it("keeps per-provider drafts across panel remounts and background refreshes", async () => {
    const first = render(<RequestParametersEditor provider="openAiCompatible" />);
    fireEvent.change(openEditor(), {
      target: { value: '{"temperature":0.7}' },
    });
    first.unmount();
    const second = render(<RequestParametersEditor provider="ollama" />);
    expect(openEditor().value).toBe("");
    second.unmount();
    render(<RequestParametersEditor provider="openAiCompatible" />);
    const input = openEditor();
    expect(input.value).toBe('{"temperature":0.7}');
    act(() => {
      const settings = testSettings();
      settings.providers[0]!.requestOverrides = { temperature: 0.4 };
      useAppStore.setState({ settings });
    });
    expect(input.value).toBe('{"temperature":0.7}');
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(input.value).toBe('{\n  "temperature": 0.4\n}');
  });

  it("exposes provider defaults through a keyboard-focusable tooltip", async () => {
    render(<RequestParametersEditor provider="ollama" />);
    const trigger = screen.getByRole("button", {
      name: "About advanced request parameters",
    });
    act(() => trigger.focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("not headers");
    expect(tooltip.textContent).toContain("options.num_predict");
    expect(tooltip.textContent).toContain("omitted fields");
  });

  it("ignores an older validation response after the draft changes", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<JsonValue>((_resolve, fail) => {
      reject = fail;
    });
    vi.mocked(ipc.validateRequestParameters).mockImplementation(async (_provider, draft) => {
      if (draft === '{"temperature":1}') return pending;
      return draft.trim() ? (JSON.parse(draft) as JsonValue) : {};
    });
    render(<RequestParametersEditor provider="openAiCompatible" />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: '{"temperature":1}' } });
    await waitFor(() =>
      expect(ipc.validateRequestParameters).toHaveBeenCalledWith(
        "openAiCompatible",
        '{"temperature":1}',
      ),
    );
    fireEvent.change(input, { target: { value: '{"temperature":0.7}' } });
    await readyToSave();
    await act(async () => {
      reject({ path: "$", message: "Old error" });
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("does not apply a pending Format after the editor unmounts", async () => {
    const view = render(<RequestParametersEditor provider="openAiCompatible" />);
    fireEvent.change(openEditor(), { target: { value: '{"temperature":0.7}' } });
    await readyToSave();
    let resolve!: (value: JsonValue) => void;
    const pending = new Promise<JsonValue>((done) => {
      resolve = done;
    });
    vi.mocked(ipc.validateRequestParameters).mockReturnValueOnce(pending);
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    view.unmount();
    await act(async () => {
      resolve({ temperature: 0.7 });
      await pending;
    });
    expect(useRequestParametersStore.getState().drafts.openAiCompatible?.text).toBe(
      '{"temperature":0.7}',
    );
  });
});
