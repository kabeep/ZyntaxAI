import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, ExternalLink, Eye, EyeOff, Info, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Callout,
  Input,
  Panel,
  Select,
  SettingGroup,
  SettingRow,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { ipc, toFixError, type ModelInfo, type ProviderId } from "@/lib/ipc";
import { useAppStore } from "@/store/useAppStore";
import { useRequestParametersStore } from "@/store/useRequestParametersStore";
import { RequestParametersEditor } from "./RequestParametersEditor";

const PROVIDERS: {
  id: ProviderId;
  label: string;
  needsKey: boolean;
  keyUrl?: string;
  docsUrl: string;
  note: string;
}[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/app/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    note: "A free tier is available and is enough for everyday use.",
  },
  {
    id: "openAiCompatible",
    label: "OpenAI-compatible",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs/models",
    note: "Works with OpenAI, OpenRouter, Groq, LM Studio and anything else speaking the same API — set the endpoint below.",
  },
  {
    id: "ollama",
    label: "Ollama",
    needsKey: false,
    docsUrl: "https://ollama.com/library",
    note: "Runs entirely on your machine. No API key, no network, and your text never leaves the computer.",
  },
];

export function ProvidersPanel() {
  const savingParameters = useRequestParametersStore((state) => state.savingProvider !== null);
  const settings = useAppStore((state) => state.settings);
  const backend = useAppStore((state) => state.secretBackend);
  const update = useAppStore((state) => state.update);

  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  const active = settings?.activeProvider ?? "gemini";
  const meta = PROVIDERS.find((provider) => provider.id === active) ?? PROVIDERS[0]!;
  const profile = settings?.providers.find((p) => p.id === active);

  useEffect(() => {
    setModels(null);
    setModelsError(null);
    setKeyDraft("");
    setKeySaved(false);
    void ipc.hasApiKey(active).then(setHasKey);
  }, [active]);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      setModels(await ipc.listModels(active));
    } catch (error) {
      const failure = toFixError(error);
      setModelsError(`${failure.message} ${failure.remedy}`);
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, [active]);


  useEffect(() => {
    if (!meta.needsKey || hasKey) void loadModels();
  }, [meta.needsKey, hasKey, loadModels]);


  useEffect(() => {
    const refresh = () => {
      if (!meta.needsKey || hasKey) void loadModels();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [meta.needsKey, hasKey, loadModels]);

  if (!settings || !profile) return null;

  const setProfile = (patch: Partial<typeof profile>) =>
    void update({
      providers: settings.providers.map((p) => (p.id === active ? { ...p, ...patch } : p)),
    });

  const saveKey = async () => {
    await ipc.setApiKey(active, keyDraft);
    setHasKey(keyDraft.trim().length > 0);
    setKeyDraft("");
    setKeySaved(true);
    await loadModels();
  };

  const modelOptions = (models ?? []).map((model) => ({
    value: model.id,
    label: model.label,
  }));


  if (!modelOptions.some((option) => option.value === profile.model)) {
    modelOptions.unshift({ value: profile.model, label: profile.model });
  }

  return (
    <Panel
      title="Providers & models"
      description="Which AI service corrects your text. You can switch at any time."
    >
      <SettingGroup title="Provider">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            disabled={savingParameters}
            onClick={() => void update({ activeProvider: provider.id })}
            aria-pressed={provider.id === active}
            className={cn(
              "block w-full px-4 py-3 text-left transition-colors duration-fast ease-out",
              provider.id === active ? "bg-accent-subtle" : "hover:bg-hover/50",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-fg">{provider.label}</span>
              {provider.id === active ? (
                <span className="text-2xs text-accent">Active</span>
              ) : null}
              {!provider.needsKey ? (
                <span className="text-2xs text-faint">no key needed</span>
              ) : null}
            </span>
            <p className="mt-1 text-xs leading-relaxed text-muted">{provider.note}</p>
          </button>
        ))}
      </SettingGroup>

      {meta.needsKey ? (
        <SettingGroup
          title="Authentication"
          description={
            backend === "keychain"
              ? "Keys are stored in your system keychain and never sent to this window."
              : "No system keychain was found, so keys are stored in an encrypted file in ZyntaxAI's data directory."
          }
        >
          <SettingRow
            label="API key"
            description={
              hasKey ? "A key is stored. Enter a new one to replace it." : "No key stored yet."
            }
            stacked
            control={
              <div className="flex gap-2">
                <Input
                  type={keyVisible ? "text" : "password"}
                  value={keyDraft}
                  onChange={(event) => {
                    setKeyDraft(event.target.value);
                    setKeySaved(false);
                  }}
                  placeholder={hasKey ? "••••••••••••••••" : "Paste your API key"}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="API key"
                />
                <Button
                  variant="secondary"
                  icon
                  onClick={() => setKeyVisible((visible) => !visible)}
                  aria-label={keyVisible ? "Hide API key" : "Show API key"}
                >
                  {keyVisible ? <EyeOff /> : <Eye />}
                </Button>
                <Button
                  variant="primary"
                  disabled={keyDraft.trim().length === 0}
                  onClick={() => void saveKey()}
                >
                  Save
                </Button>
              </div>
            }
          />

          {meta.keyUrl ? (
            <SettingRow
              label="Don't have a key?"
              description="Opens the provider's console in your browser."
              control={
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => meta.keyUrl && void openUrl(meta.keyUrl)}
                >
                  <ExternalLink />
                  Get a key
                </Button>
              }
            />
          ) : null}
        </SettingGroup>
      ) : null}

      {keySaved ? (
        <Callout tone="success" icon={<CircleCheck />} className="mb-7">
          Key saved.
        </Callout>
      ) : null}

      <SettingGroup title="Model">
        <SettingRow
          label="Model"
          description={
            active === "ollama"
              ? "Lists the models installed on this machine. Refreshes when you return to this window."
              : "Fetched live from the provider, so the list never goes stale."
          }
          control={
            <div className="flex w-64 items-center gap-2">
              {models === null && loadingModels ? (
                <Skeleton className="h-control-md flex-1" />
              ) : (
                <Select
                  disabled={savingParameters}
                  value={profile.model}
                  onValueChange={(model) => setProfile({ model })}
                  options={modelOptions}
                  aria-label="Model"
                />
              )}
              <Button
                variant="secondary"
                icon
                onClick={() => void loadModels()}
                disabled={loadingModels}
                aria-label="Refresh the model list"
              >
                <RefreshCw className={cn(loadingModels && "animate-spin")} />
              </Button>
            </div>
          }
        />
        <SettingRow
          label="Documentation"
          description="What each model is good at, and what it costs."
          control={
            <Button variant="secondary" size="md" onClick={() => void openUrl(meta.docsUrl)}>
              <ExternalLink />
              Model docs
            </Button>
          }
        />
        <SettingRow
          label="Endpoint"
          description={
            active === "openAiCompatible"
              ? "Point this at OpenRouter, Groq, LM Studio or any other compatible server."
              : "Leave blank to use the provider's default."
          }
          stacked
          control={
            <Input
              value={profile.baseUrl ?? ""}
              disabled={savingParameters}
              onChange={(event) => setProfile({ baseUrl: event.target.value || null })}
              placeholder={DEFAULT_ENDPOINTS[active]}
              spellCheck={false}
              aria-label="Endpoint"
            />
          }
        />
      </SettingGroup>

      <RequestParametersEditor key={active} provider={active} />

      {active === "ollama" ? (
        <Callout tone="neutral" icon={<Info />} title="Adding another model">
          ZyntaxAI can only list models already installed on this machine — it does not download
          them. Pull one from a terminal, then come back to this window and the list refreshes on
          its own:
          <code
            data-selectable
            className="mt-2 block rounded-md bg-inset px-2.5 py-1.5 font-mono text-xs text-fg"
          >
            ollama pull qwen2.5:7b
          </code>
          <span className="mt-2 block">
            Smaller models answer faster; larger ones correct better. Browse them with the Model
            docs button above.
          </span>
        </Callout>
      ) : null}

      {modelsError ? (
        <Callout tone="warning" icon={<CircleAlert />} title="Could not load the model list">
          {modelsError}
        </Callout>
      ) : null}
    </Panel>
  );
}

const DEFAULT_ENDPOINTS: Record<ProviderId, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openAiCompatible: "https://api.openai.com/v1",
  ollama: "http://localhost:11434",
};
