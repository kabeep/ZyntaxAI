import { useEffect, useState } from "react";
import { Button, Callout, Dialog } from "@/components/ui";
import type { ProviderId } from "@/lib/ipc";
import { parameterErrorMessage } from "@/lib/requestParameters";
import { useRequestParametersStore } from "@/store/useRequestParametersStore";

export function RequestParametersLeaveDialog({
  open,
  onCancel,
  onLeave,
}: {
  open: boolean;
  onCancel: () => void;
  onLeave: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const saveAndLeave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      for (const [provider, draft] of Object.entries(useRequestParametersStore.getState().drafts)) {
        if (draft.text !== draft.saved)
          await useRequestParametersStore.getState().save(provider as ProviderId);
      }
      onLeave();
    } catch (error) {
      setError(parameterErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
      title="Unsaved request parameters"
      description="Save or discard your provider drafts before leaving this page."
      footer={
        <>
          <Button disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              useRequestParametersStore.getState().discard();
              onLeave();
            }}
          >
            Discard
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void saveAndLeave()}>
            {saving ? "Saving…" : "Save and leave"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Unsaved drafts are kept while switching providers or collapsing the editor, but are lost
        when the application exits.
      </p>
      {error ? (
        <Callout tone="warning" title="Could not save parameters">
          <span role="alert">{error}</span>
        </Callout>
      ) : null}
    </Dialog>
  );
}
