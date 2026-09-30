import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Download, Info } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Callout, Dialog, Panel, SettingGroup, SettingRow, Switch } from "@/components/ui";
import { EVENTS, ipc, on, toFixError, type FixError, type UpdateProgress } from "@/lib/ipc";
import { UPDATES_ENABLED } from "@/lib/updates";
import { useAppStore } from "@/store/useAppStore";
import type { DisplayServer } from "@/lib/bindings/DisplayServer";
import type { HotkeyBackend } from "@/lib/bindings/HotkeyBackend";
import type { InjectionBackend } from "@/lib/bindings/InjectionBackend";

export function SystemPanel() {
  const settings = useAppStore((state) => state.settings);
  const capabilities = useAppStore((state) => state.capabilities);
  const update = useAppStore((state) => state.update);
  const refreshStats = useAppStore((state) => state.refreshStats);

  const [autostart, setAutostart] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);


  useEffect(() => {
    void ipc.isAutostartEnabled().then(setAutostart);
  }, []);

  if (!settings || !capabilities) return null;
  const { system } = settings;

  const toggleAutostart = async (enabled: boolean) => {
    setProblem(null);
    try {
      await ipc.setAutostart(enabled);
      setAutostart(enabled);
      await update({ system: { ...system, startWithOs: enabled } });
    } catch (error) {
      setProblem(toFixError(error).remedy);
      setAutostart(await ipc.isAutostartEnabled());
    }
  };

  const clearHistory = async () => {
    await ipc.clearHistory();
    await refreshStats();
    setConfirmClear(false);
  };

  return (
    <Panel title="System" description="Start-up and desktop integration.">
      <SettingGroup title="Start-up">
        <SettingRow
          label="Start with my computer"
          description="Launches ZyntaxAI when you log in, so the hotkey works straight away."
          control={
            <Switch
              checked={autostart}
              onCheckedChange={(enabled) => void toggleAutostart(enabled)}
              aria-label="Start with my computer"
            />
          }
        />
        <SettingRow
          label="Start hidden in the tray"
          description="No window on login — just the tray icon."
          control={
            <Switch
              checked={system.startMinimized}
              onCheckedChange={(startMinimized) =>
                void update({ system: { ...system, startMinimized } })
              }
              disabled={!autostart}
              aria-label="Start hidden in the tray"
            />
          }
        />
      </SettingGroup>

      {problem ? (
        <Callout tone="danger" icon={<CircleAlert />} className="mb-7">
          {problem}
        </Callout>
      ) : null}

      <UpdatesSection />

      <SettingGroup
        title="This session"
        description="What ZyntaxAI can and cannot do on your current desktop."
      >
        <div className="space-y-3 px-4 py-3.5">
          <CapabilityLine
            label="Display server"
            value={DISPLAY_SERVER_LABELS[capabilities.displayServer]}
          />
          <CapabilityLine
            label="Reading your selection"
            value={capabilities.canCaptureSelection ? "Available" : "Copy the text first"}
            ok={capabilities.canCaptureSelection}
          />
          <CapabilityLine
            label="Replacing text in place"
            value={INJECTION_LABELS[capabilities.injection]}
            ok={capabilities.injection !== "none"}
          />
          <CapabilityLine
            label="Global hotkey"
            value={HOTKEY_LABELS[capabilities.hotkey]}
            ok={capabilities.hotkey !== "externalCommand"}
          />
        </div>
      </SettingGroup>

      {capabilities.notes.map((note) => (
        <Callout
          key={note.title}
          tone={note.severity === "degraded" ? "warning" : "neutral"}
          icon={note.severity === "degraded" ? <CircleAlert /> : <Info />}
          title={note.title}
          className="mb-3"
        >
          {note.detail}
          {note.remedy ? <p className="mt-2 text-fg">{note.remedy}</p> : null}
        </Callout>
      ))}

      <div className="h-4" />

      <SettingGroup title="Data">
        <SettingRow
          label="Clear correction history"
          description="Removes the fix count and all token usage records. Cannot be undone."
          control={
            <Button variant="secondary" size="md" onClick={() => setConfirmClear(true)}>
              Clear history
            </Button>
          }
        />
      </SettingGroup>

      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear correction history?"
        description="Your fix count and all usage statistics will be deleted. This cannot be undone."
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void clearHistory()}>
              Clear history
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Your settings, personas and API keys are not affected.
        </p>
      </Dialog>
    </Panel>
  );
}


export function UpdatesSection() {
  const settings = useAppStore((state) => state.settings);
  const update = useAppStore((state) => state.update);
  const version = useAppStore((state) => state.version);
  const available = useAppStore((state) => state.availableUpdate);
  const setAvailableUpdate = useAppStore((state) => state.setAvailableUpdate);

  const [state, setState] = useState<"idle" | "checking" | "current" | "installing">("idle");
  const [failure, setFailure] = useState<FixError | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  useEffect(() => {
    if (!UPDATES_ENABLED) return;
    const unlisten = on<UpdateProgress>(EVENTS.updateProgress, setProgress);
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  if (!settings) return null;
  const { system } = settings;

  const check = async () => {
    if (!UPDATES_ENABLED) return;
    setState("checking");
    setFailure(null);
    try {
      const found = await ipc.checkForUpdate();
      setAvailableUpdate(found);
      setState(found ? "idle" : "current");
    } catch (error) {
      setFailure(toFixError(error));
      setState("idle");
    }
  };

  const install = async () => {
    if (!UPDATES_ENABLED) return;
    setState("installing");
    setFailure(null);
    try {


      await ipc.installUpdate();
    } catch (error) {
      setFailure(toFixError(error));
      setState("idle");
      setProgress(null);
    }
  };

  return (
    <>
      <SettingGroup
        title="Updates"
        description="This fork does not check for or install upstream updates."
      >
        <SettingRow
          label="Check on start-up"
          description="This fork does not check for upstream updates on start-up."
          control={
            <Switch
              checked={UPDATES_ENABLED && system.checkForUpdates}
              disabled={!UPDATES_ENABLED}
              onCheckedChange={(checkForUpdates) =>
                void update({ system: { ...system, checkForUpdates } })
              }
              aria-label="Check for updates on start-up"
            />
          }
        />
        <SettingRow
          label="This version"
          description={
            state === "current"
              ? "ZyntaxAI is up to date."
              : `You are running ${version || "—"}.`
          }
          control={
            <Button
              variant="secondary"
              size="md"
              onClick={() => void check()}
              disabled={!UPDATES_ENABLED || state === "checking" || state === "installing"}
            >
              {state === "checking" ? "Checking…" : "Check now"}
            </Button>
          }
        />
      </SettingGroup>

      {available ? (
        <Callout
          tone="accent"
          icon={<Download />}
          title={`Version ${available.version} is available`}
          className="mb-7"
        >
          {available.notes ? (
            <p className="whitespace-pre-line">{available.notes.trim()}</p>
          ) : null}

          {available.canInstall ? (
            <div className="mt-3 flex items-center gap-3">
              <Button
                variant="primary"
                size="md"
                onClick={() => void install()}
                disabled={!UPDATES_ENABLED || state === "installing"}
              >
                {state === "installing" ? "Installing…" : "Install and restart"}
              </Button>
              {state === "installing" ? (
                <span data-numeric className="text-xs text-muted">
                  {progress?.total
                    ? `${Math.round((progress.downloaded / progress.total) * 100)}%`
                    : "Downloading…"}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="mt-3">
              <p className="mb-3 text-fg">
                This copy was installed by your package manager, so ZyntaxAI will not overwrite
                it. Update it the way you installed it, or take the new build from the download
                page.
              </p>
              <Button variant="secondary" size="md" disabled={!UPDATES_ENABLED} onClick={() => void openUrl(DOWNLOAD_URL)}>
                Open download page
              </Button>
            </div>
          )}
        </Callout>
      ) : null}

      {failure ? (


        <Callout
          tone="danger"
          icon={<CircleAlert />}
          title={failure.message}
          className="mb-7"
        >
          {failure.remedy}
        </Callout>
      ) : null}
    </>
  );
}

const DOWNLOAD_URL = "https://zsync.eu/zyntaxai/";

function CapabilityLine({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="inline-flex items-center gap-1.5 text-fg">
        {ok === false ? (
          <CircleAlert className="size-3.5 text-warning" />
        ) : ok === true ? (
          <CircleCheck className="size-3.5 text-success" />
        ) : null}
        {value}
      </span>
    </div>
  );
}


const DISPLAY_SERVER_LABELS: Record<DisplayServer, string> = {
  windows: "Windows",
  macOs: "macOS",
  x11: "X11",
  wayland: "Wayland",
  unknown: "Not detected",
};

const INJECTION_LABELS: Record<InjectionBackend, string> = {
  native: "Available",
  wtype: "Available via wtype",
  ydotool: "Available via ydotool",
  none: "Unavailable — clipboard only",
};

const HOTKEY_LABELS: Record<HotkeyBackend, string> = {
  os: "Registered with the system",
  portal: "Registered through the desktop portal",
  externalCommand: "Must be bound in your compositor",
};
