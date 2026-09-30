import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PersonaDialog } from "./PersonasPanel";
import { LanguagesPanel } from "./LanguagesPanel";
import { useAppStore } from "@/store/useAppStore";
import { testSettings } from "@/lib/test/settings";
import type { Persona } from "@/lib/ipc";

const persona: Persona = {
  id: "casual",
  name: "Casual",
  instruction: "  Translate casually.\n",
  builtin: false,
  customInstructions: false,
};
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function chooseMode(label: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Prompt mode" }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: label }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("custom persona instructions", () => {
  it("uses a selector and preserves the instruction verbatim on save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<PersonaDialog open persona={persona} onSave={save} onClose={close} />);
    expect(screen.getByRole("combobox", { name: "Prompt mode" }).textContent).toContain(
      "Style instruction",
    );
    chooseMode("Custom instructions");
    expect(screen.getByLabelText("Custom instructions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({ ...persona, customInstructions: true });
  });
  it("allows selecting a mode before entering instructions without required-field warnings", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<PersonaDialog open persona={null} onSave={save} onClose={vi.fn()} />);
    const name = screen.getByPlaceholderText("Support reply");
    fireEvent.change(name, { target: { value: "New persona" } });
    fireEvent.blur(name);
    chooseMode("Custom instructions");
    expect(screen.queryByText("Both a name and an instruction are required.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Create persona" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.blur(screen.getByLabelText("Custom instructions"));
    chooseMode("Style instruction");
    chooseMode("Custom instructions");
    expect(screen.queryByText("Both a name and an instruction are required.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Custom instructions"), {
      target: { value: "Translate casually." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create persona" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ customInstructions: true }));
  });
  it("explains per-persona scope and Languages in a keyboard-accessible tooltip", async () => {
    render(<PersonaDialog open persona={persona} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.focus(screen.getByRole("button", { name: "About prompt mode" }));
    await waitFor(() =>
      expect(screen.getByRole("tooltip").textContent).toContain("saved for this persona only"),
    );
    expect(screen.getByRole("tooltip").textContent).toContain("When Translate is on in Languages");
  });
  it("keeps the draft after a failed save and permits retry", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Disk unavailable"))
      .mockResolvedValue(undefined);
    const close = vi.fn();
    render(
      <PersonaDialog
        open
        persona={{ ...persona, customInstructions: true }}
        onSave={save}
        onClose={close}
      />,
    );
    fireEvent.change(screen.getByLabelText("Custom instructions"), {
      target: { value: "whats up" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Disk unavailable"),
    );
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Custom instructions") as HTMLTextAreaElement).value).toBe(
      "whats up",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it("offers Cancel, Discard and Save before closing a dirty draft", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<PersonaDialog open persona={persona} onSave={save} onClose={close} />);
    chooseMode("Custom instructions");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Unsaved persona")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and close" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({ ...persona, customInstructions: true });
  });
  it("rejects blank and oversized UTF-8 instructions", () => {
    render(<PersonaDialog open persona={persona} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: " " } });
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "\u4e2d".repeat(22000) },
    });
    expect(screen.getByText("Instructions must not exceed 64 KiB UTF-8.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("preserves Languages controls and saved translation settings", () => {
    const settings = {
      ...testSettings(),
      personaId: persona.id,
      languageTag: "en",
      translate: true,
    };
    useAppStore.setState({
      settings,
      personas: [{ ...persona, customInstructions: true }],
      languages: [{ tag: "en", label: "English", builtin: true }],
    });
    render(<LanguagesPanel />);
    const toggle = screen.getByRole("switch", { name: "Translate into the selected language" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/This persona uses custom instructions/)).toBeTruthy();
    expect(useAppStore.getState().settings).toEqual(settings);
  });
});
