import { useState } from "react";
import { Globe, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Callout,
  Dialog,
  EmptyState,
  Input,
  Panel,
  SettingGroup,
  SettingRow,
  Switch,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/store/useAppStore";
import type { Language } from "@/lib/ipc";

export function LanguagesPanel() {
  const personas = useAppStore((state) => state.personas);
  const settings = useAppStore((state) => state.settings);
  const languages = useAppStore((state) => state.languages);
  const update = useAppStore((state) => state.update);

  const [editing, setEditing] = useState<Language | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Language | null>(null);

  if (!settings) return null;

  const custom = languages.filter((language) => !language.builtin);
  const builtin = languages.filter((language) => language.builtin);
  const autoSelected = settings.languageTag === "auto";

  const save = (language: Language) => {
    const others = settings.customLanguages.filter((l) => l.tag !== language.tag);
    void update({ customLanguages: [...others, language] });
    setEditing(null);
    setCreating(false);
  };

  const remove = (language: Language) => {
    void update({
      customLanguages: settings.customLanguages.filter((l) => l.tag !== language.tag),
      ...(settings.languageTag === language.tag ? { languageTag: "auto" } : {}),
    });
    setDeleting(null);
  };

  return (
    <Panel
      title="Languages"
      description="The language corrections come back in, and whether to translate."
      actions={
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus />
          Add language
        </Button>
      }
    >
      {personas.find((persona) => persona.id === settings.personaId)?.customInstructions ? (
        <Callout tone="neutral" className="mb-7">
          This persona uses custom instructions. Translate adds target-language instructions;
          when off, the persona controls the language without additional language rules.
        </Callout>
      ) : null}
      <SettingGroup title="Translation">
        <SettingRow
          label="Translate into the selected language"
          description="Off by default: corrections stay in the language you wrote them in."
          control={
            <Switch
              checked={settings.translate}
              onCheckedChange={(translate) => void update({ translate })}
              disabled={autoSelected}
              aria-label="Translate into the selected language"
            />
          }
        />
      </SettingGroup>

      {autoSelected && settings.translate === false ? (
        <Callout tone="neutral" className="mb-7">
          Translation needs a specific target. Choose a language below to enable it.
        </Callout>
      ) : null}

      <SettingGroup title="Built in">
        {builtin.map((language) => (
          <LanguageRow
            key={language.tag}
            language={language}
            active={language.tag === settings.languageTag}
            onSelect={() => void update({ languageTag: language.tag })}
          />
        ))}
      </SettingGroup>

      <SettingGroup title="Yours">
        {custom.length === 0 ? (
          <EmptyState
            icon={<Globe />}
            title="No custom languages"
            description="Add any language the model knows — regional variants, constructed languages, or a dialect you want it to respect."
            action={
              <Button variant="secondary" size="md" onClick={() => setCreating(true)}>
                <Plus />
                Add language
              </Button>
            }
          />
        ) : (
          custom.map((language) => (
            <LanguageRow
              key={language.tag}
              language={language}
              active={language.tag === settings.languageTag}
              onSelect={() => void update({ languageTag: language.tag })}
              onEdit={() => setEditing(language)}
              onDelete={() => setDeleting(language)}
            />
          ))
        )}
      </SettingGroup>

      <LanguageDialog
        open={creating || editing !== null}
        language={editing}
        existingTags={languages.map((l) => l.tag)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={save}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove “${deleting?.label}”?`}
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => deleting && remove(deleting)}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">This language will no longer appear in the list.</p>
      </Dialog>
    </Panel>
  );
}

function LanguageRow({
  language,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  language: Language;
  active: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 transition-colors duration-fast ease-out",
        active ? "bg-accent-subtle" : "hover:bg-hover/50",
      )}
    >
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-pressed={active}
      >
        <span className="text-sm text-fg">{language.label}</span>
        <span data-numeric className="text-2xs text-faint">
          {language.tag}
        </span>
        {active ? <span className="text-2xs text-accent">Active</span> : null}
        {language.builtin ? <Lock className="size-3 text-faint" aria-label="Built in" /> : null}
      </button>

      {onEdit && onDelete ? (
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-within:opacity-100">
          <Button variant="ghost" size="sm" icon onClick={onEdit} aria-label={`Edit ${language.label}`}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={onDelete}
            aria-label={`Remove ${language.label}`}
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LanguageDialog({
  open,
  language,
  existingTags,
  onClose,
  onSave,
}: {
  open: boolean;
  language: Language | null;
  existingTags: string[];
  onClose: () => void;
  onSave: (language: Language) => void;
}) {
  const [label, setLabel] = useState("");
  const [tag, setTag] = useState("");

  const key = `${open}:${language?.tag ?? "new"}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setLabel(language?.label ?? "");
    setTag(language?.tag ?? "");
  }

  const trimmedTag = tag.trim().toLowerCase();

  const duplicate =
    trimmedTag !== (language?.tag ?? "") && existingTags.includes(trimmedTag);
  const valid = label.trim().length > 0 && trimmedTag.length > 0 && !duplicate;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={language ? "Edit language" : "Add language"}
      description="The name is what the model is told to write in, so use the language's own name where that matters."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => onSave({ tag: trimmedTag, label: label.trim(), builtin: false })}
          >
            {language ? "Save changes" : "Add language"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-fg">Name</span>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Swiss German"
            autoFocus
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-fg">Tag</span>
          <Input
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="de-CH"
            spellCheck={false}
          />
          <span className="mt-1.5 block text-2xs text-faint">
            A short identifier, usually the BCP-47 code. Only used to tell entries apart.
          </span>
        </label>

        {duplicate ? (
          <p className="text-xs text-danger">That tag is already in the list.</p>
        ) : null}
      </div>
    </Dialog>
  );
}
