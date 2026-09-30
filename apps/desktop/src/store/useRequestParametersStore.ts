import { create } from "zustand";
import { ipc, type JsonValue, type ProviderId } from "@/lib/ipc";
import { parameterText } from "@/lib/requestParameters";
import { useAppStore } from "./useAppStore";

export interface ParameterDraft {
  text: string;
  saved: string;
}

interface RequestParametersStore {
  drafts: Partial<Record<ProviderId, ParameterDraft>>;
  savingProvider: ProviderId | null;
  sync: (provider: ProviderId, value: JsonValue) => void;
  edit: (provider: ProviderId, text: string) => void;
  revert: (provider: ProviderId) => void;
  discard: () => void;
  save: (provider: ProviderId) => Promise<void>;
}

// Session-only drafts survive panel/provider switches, but are never stored on
// disk until Save. They are intentionally lost when the application exits.
export const useRequestParametersStore = create<RequestParametersStore>((set, get) => ({
  drafts: {},
  savingProvider: null,
  sync: (provider, value) => {
    const saved = parameterText(value);
    const previous = get().drafts[provider];
    if (previous?.saved === saved) return;
    const text = previous && previous.text !== previous.saved ? previous.text : saved;
    set({ drafts: { ...get().drafts, [provider]: { text, saved } } });
  },
  edit: (provider, text) => {
    if (get().savingProvider) return;
    const previous = get().drafts[provider];
    set({
      drafts: {
        ...get().drafts,
        [provider]: { text, saved: previous?.saved ?? "" },
      },
    });
  },
  revert: (provider) => {
    if (get().savingProvider) return;
    const previous = get().drafts[provider];
    if (previous)
      set({
        drafts: {
          ...get().drafts,
          [provider]: { ...previous, text: previous.saved },
        },
      });
  },
  discard: () => {
    if (get().savingProvider) return;
    set({
      drafts: Object.fromEntries(
        Object.entries(get().drafts).map(([provider, draft]) => [
          provider,
          { ...draft, text: draft.saved },
        ]),
      ),
    });
  },
  save: async (provider) => {
    if (get().savingProvider) throw new Error("Request parameters are already being saved.");
    const draft = get().drafts[provider];
    if (!draft || draft.text === draft.saved) return;
    set({ savingProvider: provider });
    try {
      // A dedicated backend command merges into the latest settings under its
      // mutex, rather than submitting an old copy of the complete document.
      const settings = await ipc.saveRequestParameters(provider, draft.text);
      const profile = settings.providers.find((profile) => profile.id === provider);
      if (!profile) throw new Error("Saved provider profile is missing.");
      const saved = parameterText(profile.requestOverrides);
      useAppStore.setState({ settings, saveError: null });
      set({
        drafts: { ...get().drafts, [provider]: { text: saved, saved } },
      });
    } finally {
      set({ savingProvider: null });
    }
  },
}));
