import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ipc } from "@/lib/ipc";
import { testSettings } from "@/lib/test/settings";
import { useAppStore } from "@/store/useAppStore";
import { UpdatesSection } from "./SystemPanel";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("upstream updates disabled in fork builds", () => {
  for (const canInstall of [true, false]) {
    it(`disables all controls with old enabled settings and pending update (installable: ${canInstall})`, () => {
      const settings = testSettings();
      settings.system.checkForUpdates = true;
      const update = vi.fn();
      useAppStore.setState({
        settings,
        version: "1.0.2",
        update,
        availableUpdate: {
          version: "1.0.3",
          currentVersion: "1.0.2",
          notes: "Update",
          date: null,
          canInstall,
        },
      });
      const check = vi.spyOn(ipc, "checkForUpdate");
      const install = vi.spyOn(ipc, "installUpdate");
      render(<UpdatesSection />);
      const startup = screen.getByRole("switch", { name: "Check for updates on start-up" });
      expect((startup as HTMLButtonElement).disabled).toBe(true);
      expect(startup.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(startup);
      for (const name of ["Check now", canInstall ? "Install and restart" : "Open download page"]) {
        const button = screen.getByRole("button", { name });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(button);
      }
      expect(update).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
      expect(openUrl).not.toHaveBeenCalled();
    });
  }
});
