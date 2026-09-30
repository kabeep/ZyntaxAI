import { UPDATES_ENABLED } from "@/lib/updates";
import { useEffect, useState, type ComponentType } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BarChart3,
  Boxes,
  Info,
  Keyboard,
  Languages,
  Monitor,
  ArrowUpCircle,
  Palette,
  ScrollText,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { StatusDot, Switch } from "@/components/ui";
import { Sidebar, type SidebarEntry } from "@/components/ui/Sidebar";
import { ResizeEdges, Titlebar } from "@/components/ui/Titlebar";
import { useAppStore } from "@/store/useAppStore";
import { useRequestParametersStore } from "@/store/useRequestParametersStore";
import { RequestParametersLeaveDialog } from "./panels/RequestParametersLeaveDialog";
import { EVENTS, on, type UpdateInfo } from "@/lib/ipc";
import { relativeTime } from "@/lib/format";
import { AboutPanel } from "./panels/AboutPanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { BehaviorPanel } from "./panels/BehaviorPanel";
import { HotkeysPanel } from "./panels/HotkeysPanel";
import { LanguagesPanel } from "./panels/LanguagesPanel";
import { LogsPanel } from "./panels/LogsPanel";
import { PersonasPanel } from "./panels/PersonasPanel";
import { ProvidersPanel } from "./panels/ProvidersPanel";
import { SystemPanel } from "./panels/SystemPanel";
import { UsagePanel } from "./panels/UsagePanel";

const SECTIONS = [
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard },
  { id: "personas", label: "Personas", icon: Users },
  { id: "languages", label: "Languages", icon: Languages },
  { id: "providers", label: "Providers", icon: Boxes },
  { id: "behavior", label: "Behavior", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "usage", label: "Usage", icon: BarChart3 },
  { id: "system", label: "System", icon: Monitor },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "about", label: "About", icon: Info },
] as const satisfies readonly SidebarEntry[];

type SectionId = (typeof SECTIONS)[number]["id"];

const PANELS: Record<SectionId, ComponentType> = {
  hotkeys: HotkeysPanel,
  personas: PersonasPanel,
  languages: LanguagesPanel,
  providers: ProvidersPanel,
  behavior: BehaviorPanel,
  appearance: AppearancePanel,
  usage: UsagePanel,
  system: SystemPanel,
  logs: LogsPanel,
  about: AboutPanel,
};

export function App() {
  const drafts = useRequestParametersStore((state) => state.drafts);
  const savingParameters = useRequestParametersStore((state) => state.savingProvider !== null);
  const [pendingSection, setPendingSection] = useState<SectionId | null>(null);
  const [section, setSection] = useState<SectionId>("hotkeys");
  const [maximized, setMaximized] = useState(false);
  const loading = useAppStore((state) => state.loading);
  const settings = useAppStore((state) => state.settings);
  const stats = useAppStore((state) => state.stats);
  const hydrate = useAppStore((state) => state.hydrate);
  const refreshStats = useAppStore((state) => state.refreshStats);
  const update = useAppStore((state) => state.update);
  const availableUpdate = useAppStore((state) => state.availableUpdate);
  const setAvailableUpdate = useAppStore((state) => state.setAvailableUpdate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);


  useEffect(() => {
    const unlisten = on(EVENTS.fixCompleted, () => void refreshStats());
    return () => {
      void unlisten.then((off) => off());
    };
  }, [refreshStats]);


  useEffect(() => {
    const unlisten = on(EVENTS.settingsChanged, () => void hydrate());
    return () => {
      void unlisten.then((off) => off());
    };
  }, [hydrate]);


  useEffect(() => {
    const unlisten = on<UpdateInfo>(EVENTS.updateAvailable, setAvailableUpdate);
    return () => {
      void unlisten.then((off) => off());
    };
  }, [setAvailableUpdate]);


  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    const sync = () => {
      void appWindow.isMaximized().then((value) => {
        if (!cancelled) setMaximized(value);
      });
    };
    sync();
    const unlisten = appWindow.onResized(sync);
    return () => {
      cancelled = true;
      void unlisten.then((off) => off());
    };
  }, []);


  useEffect(() => {
    const theme = settings?.appearance.theme ?? "system";
    const root = document.documentElement;

    if (theme !== "system") {
      root.setAttribute("data-theme", theme);
      return;
    }

    const query = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => root.setAttribute("data-theme", query.matches ? "light" : "dark");

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [settings?.appearance.theme]);


  useEffect(() => {
    document.documentElement.style.opacity = String((settings?.appearance.opacity ?? 100) / 100);
  }, [settings?.appearance.opacity]);

  const Panel = PANELS[section];
  const enabled = settings?.enabled ?? true;

  const selectSection = (next: SectionId) => {
    if (savingParameters) return;
    if (section === "providers" && next !== section && Object.values(drafts).some((draft) => draft.text !== draft.saved)) {
      setPendingSection(next);
    } else { setSection(next); }
  };

  return (
    <>
      <ResizeEdges />
      <div className="window-shell flex flex-col" data-maximized={maximized}>
        <Titlebar />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            entries={SECTIONS as unknown as SidebarEntry<SectionId>[]}
            layout={settings?.sidebar ?? { categories: [] }}
            active={section}
            onSelect={selectSection}
            onLayoutChange={(sidebar) => void update({ sidebar })}


            onResetLayout={() => void update({ sidebar: { categories: [] } })}
            footer={
              loading ? (
                <StatusDot tone="neutral">Starting…</StatusDot>
              ) : (
                <div className="space-y-2">


                  {UPDATES_ENABLED && availableUpdate ? (
                    <button
                      type="button"
                      onClick={() => setSection("system")}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs text-accent transition-colors duration-fast hover:bg-hover/60"
                    >
                      <ArrowUpCircle className="size-3.5 shrink-0" />
                      <span data-numeric className="truncate">
                        Update to {availableUpdate.version}
                      </span>
                    </button>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <StatusDot tone={enabled ? "success" : "neutral"}>
                      {enabled ? "Ready" : "Off"}
                    </StatusDot>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(next) => void update({ enabled: next })}
                      aria-label={enabled ? "Turn corrections off" : "Turn corrections on"}
                    />
                  </div>
                  <p data-numeric className="text-2xs text-faint">
                    {enabled ? (
                      <>
                        {stats?.totalFixes ?? 0} fixes &middot; {relativeTime(stats?.lastFix)}
                      </>
                    ) : (
                      "The hotkey will not correct anything"
                    )}
                  </p>
                </div>
              )
            }
          />

          <main className="min-w-0 flex-1">{loading ? null : <Panel />}</main>
        </div>
      </div>
      <RequestParametersLeaveDialog open={pendingSection !== null} onCancel={() => setPendingSection(null)} onLeave={() => {
        if (pendingSection) setSection(pendingSection);
        setPendingSection(null);
      }} />
    </>
  );
}
