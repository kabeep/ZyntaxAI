import type { AppSettings, ProviderId } from "../ipc";

export function testSettings(): AppSettings {
  const ids: ProviderId[] = ["openAiCompatible", "ollama", "gemini"];
  return {
    schemaVersion: 1,
    enabled: true,
    hotkey: "F8",
    personaId: "default",
    customPersonas: [],
    languageTag: "auto",
    customLanguages: [],
    translate: false,
    speed: "normal",
    activeProvider: "openAiCompatible",
    pricing: {},
    providers: ids.map((id) => ({
      id,
      baseUrl: null,
      model: "test-model",
      requestOverrides: {},
    })),
    behavior: {
      inputSource: "selection",
      outputMode: "replace",
      minimizeToTray: true,
      showNotifications: true,
      playSound: false,
      autoCopyFixed: false,
      keepHistory: true,
    },
    system: {
      startWithOs: false,
      startMinimized: false,
      checkForUpdates: true,
    },
    appearance: { theme: "system", opacity: 100 },
    sidebar: { categories: [] },
  };
}
