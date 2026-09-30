import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Info, Lock, Pencil, Plus, Trash2, Users } from "lucide-react";
import {
  Button,
  Dialog,
  EmptyState,
  Input,
  Panel,
  SettingGroup,
  Select,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/store/useAppStore";
import type { Persona } from "@/lib/ipc";

export function PersonasPanel() {
  const settings = useAppStore((state) => state.settings);
  const personas = useAppStore((state) => state.personas);
  const update = useAppStore((state) => state.update);

  const [editing, setEditing] = useState<Persona | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Persona | null>(null);

  if (!settings) return null;

  const custom = personas.filter((persona) => !persona.builtin);
  const builtin = personas.filter((persona) => persona.builtin);

  const select = (id: string) => void update({ personaId: id });

  const save = async (persona: Persona) => {
    const others = settings.customPersonas.filter((p) => p.id !== persona.id);
    await update({ customPersonas: [...others, persona] });
    setEditing(null);
    setCreating(false);
  };

  const remove = (persona: Persona) => {
    void update({
      customPersonas: settings.customPersonas.filter((p) => p.id !== persona.id),

      ...(settings.personaId === persona.id ? { personaId: "standard" } : {}),
    });
    setDeleting(null);
  };

  return (
    <Panel
      title="Personas"
      description="The writing style applied on top of grammar correction."
      actions={
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus />
          New persona
        </Button>
      }
    >
      <SettingGroup title="Built in">
        {builtin.map((persona) => (
          <PersonaRow
            key={persona.id}
            persona={persona}
            active={persona.id === settings.personaId}
            onSelect={() => select(persona.id)}
          />
        ))}
      </SettingGroup>

      <SettingGroup title="Yours">
        {custom.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="No custom personas yet"
            description="Create one to give the model a voice of your own — a house style, a tone for a particular client, anything."
            action={
              <Button variant="secondary" size="md" onClick={() => setCreating(true)}>
                <Plus />
                New persona
              </Button>
            }
          />
        ) : (
          custom.map((persona) => (
            <PersonaRow
              key={persona.id}
              persona={persona}
              active={persona.id === settings.personaId}
              onSelect={() => select(persona.id)}
              onEdit={() => setEditing(persona)}
              onDelete={() => setDeleting(persona)}
            />
          ))
        )}
      </SettingGroup>

      <PersonaDialog
        open={creating || editing !== null}
        persona={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={save}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => deleting && remove(deleting)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">This persona will be removed. This cannot be undone.</p>
      </Dialog>
    </Panel>
  );
}

function PersonaRow({
  persona,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  persona: Persona;
  active: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-start gap-3 px-4 py-3 transition-colors duration-fast ease-out",
        active ? "bg-accent-subtle" : "hover:bg-hover/50",
      )}
    >
      <button
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
        aria-pressed={active}
        aria-label={`Use the ${persona.name} persona`}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg">{persona.name}</span>
          {active ? <span className="text-2xs text-accent">Active</span> : null}
          {persona.customInstructions ? (
            <span className="text-2xs text-muted">Custom instructions</span>
          ) : null}
          {persona.builtin ? <Lock className="size-3 text-faint" aria-label="Built in" /> : null}
        </span>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
          {persona.instruction}
        </p>
      </button>

      {onEdit && onDelete ? (
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-within:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={onEdit}
            aria-label={`Edit ${persona.name}`}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={onDelete}
            aria-label={`Delete ${persona.name}`}
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PersonaDialog({
  open,
  persona,
  onClose,
  onSave,
}: {
  open: boolean;
  persona: Persona | null;
  onClose: () => void;
  onSave: (persona: Persona) => Promise<void>;
}) {
  const [name, setName] = useState(persona?.name ?? "");
  const [instruction, setInstruction] = useState(persona?.instruction ?? "");
  const [customInstructions, setCustomInstructions] = useState(
    persona?.customInstructions ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const key = `${open}:${persona?.id ?? "new"}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setName(persona?.name ?? "");
    setInstruction(persona?.instruction ?? "");
    setCustomInstructions(persona?.customInstructions ?? false);
    setError(null);
    setConfirmClose(false);
  }

  const tooLong = new TextEncoder().encode(instruction).length > 64 * 1024;
  const valid = name.trim().length > 0 && instruction.trim().length > 0 && !tooLong;
  const dirty =
    name !== (persona?.name ?? "") ||
    instruction !== (persona?.instruction ?? "") ||
    customInstructions !== (persona?.customInstructions ?? false);
  const close = () => {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: persona?.id ?? crypto.randomUUID(),
        name: name.trim(),
        instruction,
        builtin: false,
        customInstructions,
      });
      setConfirmClose(false);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : typeof failure === "object" && failure && "message" in failure
            ? String(failure.message)
            : "Could not save the persona. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => !next && close()}
        title={persona ? "Edit persona" : "New persona"}
        description="Set the instructions the model receives for this persona."
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!valid || saving} onClick={() => void save()}>
              {persona ? "Save changes" : "Create persona"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg">Name</span>
            <Input
              disabled={saving}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Support reply"
              autoFocus
            />
          </label>

          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <span className="text-xs font-medium text-fg">Prompt mode</span>
              <Tooltip.Provider delayDuration={200}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button variant="ghost" size="sm" icon aria-label="About prompt mode">
                      <Info />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="top"
                      sideOffset={6}
                      className="z-50 max-w-sm rounded-lg border border-line bg-surface p-3 text-xs leading-relaxed text-muted shadow-overlay"
                    >
                      <p>
                        This mode is saved for this persona only. Style instruction uses the app's
                        default prompts; Custom instructions replaces them with your instructions.
                      </p>
                      <p className="mt-2">
                        When Translate is on in Languages, target-language instructions are still
                        added. When off, your instructions control the language.
                      </p>
                      <p className="mt-2">
                        In Custom instructions mode, define the task and output format yourself.
                        Selected text is sent as-is and output formatting is preserved.
                      </p>
                      <Tooltip.Arrow className="fill-surface" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            </div>
            <Select
              aria-label="Prompt mode"
              value={customInstructions ? "custom" : "style"}
              onValueChange={(value) => setCustomInstructions(value === "custom")}
              disabled={saving}
              options={[
                { value: "style", label: "Style instruction" },
                { value: "custom", label: "Custom instructions" },
              ]}
            />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg">
              {customInstructions ? "Custom instructions" : "Instruction"}
            </span>
            <Textarea
              aria-label={customInstructions ? "Custom instructions" : "Instruction"}
              disabled={saving}
              rows={5}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={
                customInstructions
                  ? "Describe the task, tone and output format."
                  : "Correct the text and make it warm but efficient. Never promise a timeline the author did not give."
              }
            />
            <span className="mt-1.5 block text-2xs leading-relaxed text-faint">
              Describe what to change and what to preserve. Limit: 64 KiB UTF-8.
            </span>
          </label>

          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          {tooLong ? (
            <p className="text-xs text-danger">Instructions must not exceed 64 KiB UTF-8.</p>
          ) : null}
        </div>
      </Dialog>
      <Dialog
        open={confirmClose}
        onOpenChange={(next) => !saving && setConfirmClose(next)}
        title="Unsaved persona"
        description="Save your changes before closing?"
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={() => setConfirmClose(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              Discard
            </Button>
            <Button variant="primary" disabled={!valid || saving} onClick={() => void save()}>
              Save and close
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Changes will be lost if you discard them.</p>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
