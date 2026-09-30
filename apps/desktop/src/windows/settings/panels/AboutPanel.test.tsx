import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ipc } from "@/lib/ipc";
import { useAppStore } from "@/store/useAppStore";
import { AboutPanel } from "./AboutPanel";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
beforeEach(() => {
  useAppStore.setState({ version: "1.0.2", secretBackend: "encryptedFile" });
  vi.spyOn(ipc, "getPaths").mockResolvedValue({ config: "config", data: "data", logs: "logs" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(openUrl).mockClear();
});

describe("fork About page", () => {
  it("routes fork downloads/source separately from upstream attribution", async () => {
    render(<AboutPanel />);
    await waitFor(() => expect(screen.getByText("config")).toBeTruthy());
    expect(screen.getByText("Fork")).toBeTruthy();
    expect(screen.getByText(/Based on ZyntaxAI by TheHolyOneZ/)).toBeTruthy();
    for (const [name, url] of [
      [/^Download/, "https://github.com/kabeep/ZyntaxAI/releases"],
      [/^Source code/, "https://github.com/kabeep/ZyntaxAI"],
      [/^Original project/, "https://github.com/TheHolyOneZ/ZyntaxAI"],
      [/^Original author/, "https://github.com/TheHolyOneZ"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(openUrl).toHaveBeenLastCalledWith(url);
    }
    expect(screen.getByText(/2026 TheHolyOneZ/)).toBeTruthy();
    expect(screen.getByText(/provided without warranty/)).toBeTruthy();
  });
  it("opens the complete bundled licence without a browser or network request", async () => {
    render(<AboutPanel />);
    await waitFor(() => expect(screen.getByText("config")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "View licence" }));
    const licence = screen.getByRole("dialog", { name: "GNU General Public License" });
    expect(licence.textContent).toContain("Copyright (c) 2026 TheHolyOneZ");
    expect(licence.textContent).toContain("modified version maintained by kabeep");
    expect(licence.textContent).toContain("2026-09-29 and 2026-09-30");
    expect(licence.textContent).toContain("Conveying Modified Source Versions.");
    expect(licence.textContent).toContain("If the program does terminal interaction");
    expect(openUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close licence" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
