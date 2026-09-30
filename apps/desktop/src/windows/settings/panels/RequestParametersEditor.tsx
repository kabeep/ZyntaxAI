import { useEffect, useId, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import { Button, Callout, Textarea } from "@/components/ui";
import { ipc, type ProviderId } from "@/lib/ipc";
import {
  basicParameterError,
  isObject,
  parameterErrorMessage,
  parameterText,
  PARAMETER_PATHS,
  PARAMETER_PLACEHOLDERS,
} from "@/lib/requestParameters";
import { useAppStore } from "@/store/useAppStore";
import { useRequestParametersStore } from "@/store/useRequestParametersStore";

export function RequestParametersEditor({ provider }: { provider: ProviderId }) {
  const profile = useAppStore((state) =>
    state.settings?.providers.find((profile) => profile.id === provider),
  );
  const draft = useRequestParametersStore((state) => state.drafts[provider]);
  const savingProvider = useRequestParametersStore((state) => state.savingProvider);
  const { sync, edit, revert, save } = useRequestParametersStore();
  const [validation, setValidation] = useState<{
    text: string;
    error: string | null;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = useId();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const text = draft?.text ?? (profile ? parameterText(profile.requestOverrides) : "");
  const localError = basicParameterError(text);
  const dirty = !!draft && draft.text !== draft.saved;
  const busy = savingProvider !== null;
  const validating = !localError && validation?.text !== text;
  const validationError = localError ?? (validation?.text === text ? validation.error : null);
  const error = validationError ?? actionError;
  const count =
    profile && isObject(profile.requestOverrides)
      ? Object.keys(profile.requestOverrides).length
      : 0;

  useEffect(() => {
    if (profile) sync(provider, profile.requestOverrides);
  }, [provider, profile, sync]);
  useEffect(() => {
    setActionError(null);
    setValidation(null);
    if (localError) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void ipc.validateRequestParameters(provider, text).then(
        () => {
          if (!cancelled) setValidation({ text, error: null });
        },
        (error: unknown) => {
          if (!cancelled) setValidation({ text, error: parameterErrorMessage(error) });
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, text, localError]);

  const format = async () => {
    try {
      const value = await ipc.validateRequestParameters(provider, text);
      if (!mounted.current || useRequestParametersStore.getState().drafts[provider]?.text !== text)
        return;
      edit(provider, parameterText(value));
      setSaved(false);
      setActionError(null);
    } catch (error) {
      setActionError(parameterErrorMessage(error));
    }
  };
  const submit = async () => {
    try {
      await save(provider);
      setSaved(true);
      setActionError(null);
    } catch (error) {
      setActionError(parameterErrorMessage(error));
    }
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
          Advanced request parameters
        </h2>
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant="ghost" size="sm" icon aria-label="About advanced request parameters">
                <Info />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="top"
                sideOffset={6}
                className="z-50 max-w-md rounded-lg border border-line bg-surface p-3 text-xs leading-relaxed text-muted shadow-overlay"
              >
                <p>
                  Extra JSON fields in the HTTP request body, not headers. Enter fields directly,
                  without an extra_body wrapper. Keep API keys in Authentication.
                </p>
                <p className="mt-2">
                  Objects merge recursively. Custom values override the same paths; omitted fields
                  keep their application defaults. Arrays and null replace values; null does not
                  delete a field.
                </p>
                <p className="mt-2">
                  Processing depth supplies {PARAMETER_PATHS[provider]}. Fast / Normal / Detailed
                  use temperature 0.1 / 0.3 / 0.5 and base token budgets 512 / 1024 / 2048,
                  increasing with input length up to 8192. Overriding temperature alone retains the
                  token budget.
                </p>
                <p className="mt-2">
                  Model, messages and response protocol fields are protected. Thinking has no
                  application default. Supported parameters vary by model and provider; local
                  validation does not prove API support.
                </p>
                {provider === "openAiCompatible" ? (
                  <p className="mt-2">
                    For DeepSeek models that support it, thinking can be disabled with{" "}
                    {`{"thinking":{"type":"disabled"}}`}. This is provider-specific.
                  </p>
                ) : null}
                <Tooltip.Arrow className="fill-surface" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
      <details className="rounded-lg border border-line-subtle bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg">
          Edit JSON parameters
          {count ? <span className="ml-2 text-xs text-muted">{count} configured</span> : null}
          {dirty ? <span className="ml-2 text-xs text-warning">Unsaved</span> : null}
          {error ? <span className="ml-2 text-xs text-warning">Check JSON</span> : null}
        </summary>
        <div className="space-y-3 border-t border-line-subtle px-4 py-3">
          <label htmlFor={id} className="block text-sm font-medium text-fg">
            Custom JSON parameters
          </label>
          <Textarea
            id={id}
            value={text}
            onChange={(event) => {
              edit(provider, event.target.value);
              setSaved(false);
            }}
            rows={10}
            spellCheck={false}
            disabled={busy}
            className="font-mono text-xs"
            placeholder={PARAMETER_PLACEHOLDERS[provider]}
            aria-invalid={!!error}
            aria-describedby={`${id}-help ${id}-status`}
          />
          <p id={`${id}-help`} className="text-xs leading-relaxed text-muted">
            Only saved parameters are sent. Clearing and saving restores defaults. Parameters stay
            with this provider when you change its model or endpoint; check compatibility. Unsaved
            drafts are lost when the app exits.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!dirty || busy || validating || !!validationError}
              onClick={() => void submit()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              disabled={busy || validating || !!localError || !!validation?.error}
              onClick={() => void format()}
            >
              Format
            </Button>
            <Button
              size="sm"
              disabled={!dirty || busy}
              onClick={() => {
                revert(provider);
                setActionError(null);
                setSaved(false);
              }}
            >
              Revert
            </Button>
            <Button
              size="sm"
              disabled={!text || busy}
              onClick={() => {
                edit(provider, "");
                setSaved(false);
              }}
            >
              Clear
            </Button>
            <span id={`${id}-status`} role="status" className="text-xs text-muted">
              {dirty ? "Unsaved changes" : saved ? "Saved" : validating ? "Validating…" : ""}
            </span>
          </div>
          {error ? (
            <Callout tone="warning" title="Check request parameters">
              <span role="alert">{error}</span>
            </Callout>
          ) : null}
        </div>
      </details>
    </section>
  );
}
