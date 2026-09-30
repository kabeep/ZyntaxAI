import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { testSettings } from "@/lib/test/settings";
import { useAppStore } from "@/store/useAppStore";
import { useRequestParametersStore } from "@/store/useRequestParametersStore";
import { RequestParametersLeaveDialog } from "./RequestParametersLeaveDialog";

beforeEach(() => {
  useAppStore.setState({ settings: testSettings() });
  useRequestParametersStore.setState({
    drafts: { ollama: { saved: "", text: '{"think":false}' } },
    savingProvider: null,
  });
  vi.spyOn(ipc, "saveRequestParameters").mockResolvedValue({
    ...testSettings(),
    providers: testSettings().providers.map((profile) =>
      profile.id === "ollama" ? { ...profile, requestOverrides: { think: false } } : profile,
    ),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("leaving request parameter drafts", () => {
  it("Cancel keeps drafts and stays on the page", () => {
    const cancel = vi.fn();
    const leave = vi.fn();
    render(<RequestParametersLeaveDialog open onCancel={cancel} onLeave={leave} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
    expect(useRequestParametersStore.getState().drafts.ollama?.text).toBe('{"think":false}');
    expect(ipc.saveRequestParameters).not.toHaveBeenCalled();
  });
  it("Discard restores drafts without changing saved settings", () => {
    const leave = vi.fn();
    render(<RequestParametersLeaveDialog open onCancel={vi.fn()} onLeave={leave} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(useRequestParametersStore.getState().drafts.ollama?.text).toBe("");
    expect(leave).toHaveBeenCalledOnce();
    expect(ipc.saveRequestParameters).not.toHaveBeenCalled();
  });
  it("Save and leave persists the raw draft before navigating", async () => {
    const leave = vi.fn();
    render(<RequestParametersLeaveDialog open onCancel={vi.fn()} onLeave={leave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(leave).toHaveBeenCalledOnce());
    expect(ipc.saveRequestParameters).toHaveBeenCalledWith("ollama", '{"think":false}');
    const draft = useRequestParametersStore.getState().drafts.ollama;
    expect(draft?.text).toBe(draft?.saved);
  });
  it("failed validation preserves the draft and prevents navigation", async () => {
    vi.mocked(ipc.saveRequestParameters).mockRejectedValue({
      code: "request_parameters",
      message: "Duplicate key",
      remedy: "Fix JSON",
      retryable: false,
    });
    const leave = vi.fn();
    render(<RequestParametersLeaveDialog open onCancel={vi.fn()} onLeave={leave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Duplicate key"));
    expect(leave).not.toHaveBeenCalled();
    expect(useRequestParametersStore.getState().drafts.ollama?.text).toBe('{"think":false}');
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save and leave" }).disabled).toBe(
      false,
    );
  });
});
