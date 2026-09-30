

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AppPaths } from "./bindings/AppPaths";
import type { AppSettings } from "./bindings/AppSettings";
import type { Capabilities } from "./bindings/Capabilities";
import type { FixError } from "./bindings/FixError";
import type { FixOutcome } from "./bindings/FixOutcome";
import type { DailyUsage } from "./bindings/DailyUsage";
import type { FixRecord } from "./bindings/FixRecord";
import type { HotkeyStatus } from "./bindings/HotkeyStatus";
import type { Language } from "./bindings/Language";
import type { LogLine } from "./bindings/LogLine";
import type { ModelInfo } from "./bindings/ModelInfo";
import type { OutputMode } from "./bindings/OutputMode";
import type { Persona } from "./bindings/Persona";
import type { ProviderId } from "./bindings/ProviderId";
import type { JsonValue } from "./bindings/serde_json/JsonValue";
import type { RequestParameterError } from "./bindings/RequestParameterError";
import type { SecretBackend } from "./bindings/SecretBackend";
import type { Stats } from "./bindings/Stats";
import type { UpdateInfo } from "./bindings/UpdateInfo";
import type { UpdateProgress } from "./bindings/UpdateProgress";
import type { UsageReport } from "./bindings/UsageReport";

export type {
  AppPaths,
  DailyUsage,
  AppSettings,
  Capabilities,
  FixError,
  FixOutcome,
  FixRecord,
  HotkeyStatus,
  Language,
  LogLine,
  ModelInfo,
  OutputMode,
  Persona,
  ProviderId,
  JsonValue,
  RequestParameterError,
  SecretBackend,
  Stats,
  UpdateInfo,
  UpdateProgress,
  UsageReport,
};


export function toFixError(error: unknown): FixError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "remedy" in error
  ) {
    return error as FixError;
  }
  return {
    code: "unexpected",
    message: String(error),
    remedy: "If this keeps happening, check the Logs panel and report it.",
    retryable: false,
  };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toFixError(error);
  }
}

export const ipc = {

  getSettings: () => call<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => call<AppSettings>("save_settings", { settings }),
  validateRequestParameters: (provider: ProviderId, draft: string) =>
    invoke<JsonValue>("validate_request_parameters", { provider, draft }),
  saveRequestParameters: (provider: ProviderId, draft: string) =>
    call<AppSettings>("save_request_parameters", { provider, draft }),
  getPersonas: () => call<Persona[]>("get_personas"),
  getLanguages: () => call<Language[]>("get_languages"),


  getCapabilities: () => call<Capabilities>("get_capabilities"),
  getPaths: () => call<AppPaths>("get_paths"),
  appVersion: () => call<string>("app_version"),


  validateHotkey: (accelerator: string) => call<string>("validate_hotkey", { accelerator }),

  getHotkeyStatus: () => call<HotkeyStatus>("get_hotkey_status"),


  listModels: (provider: ProviderId) => call<ModelInfo[]>("list_models", { provider }),
  setApiKey: (provider: ProviderId, key: string) => call<void>("set_api_key", { provider, key }),

  hasApiKey: (provider: ProviderId) => call<boolean>("has_api_key", { provider }),
  getSecretBackend: () => call<SecretBackend>("get_secret_backend"),


  getStats: () => call<Stats>("get_stats"),
  getUsage: () => call<UsageReport>("get_usage"),
  getDailyUsage: (days: number) => call<DailyUsage[]>("get_daily_usage", { days }),
  getRecent: (limit: number) => call<FixRecord[]>("get_recent", { limit }),
  clearHistory: () => call<void>("clear_history"),


  getLogs: (limit: number) => call<LogLine[]>("get_logs", { limit }),
  clearLogs: () => call<void>("clear_logs"),


  checkForUpdate: () => call<UpdateInfo | null>("check_for_update"),

  pendingUpdate: () => call<UpdateInfo | null>("pending_update"),

  installUpdate: () => call<void>("install_update"),


  setAutostart: (enabled: boolean) => call<void>("set_autostart", { enabled }),
  isAutostartEnabled: () => call<boolean>("is_autostart_enabled"),


  runFix: () => call<void>("run_fix"),
  cancelFix: () => call<void>("cancel_fix"),
  applyFix: (corrected: string, original: string, mode: OutputMode) =>
    call<void>("apply_fix", { corrected, original, mode }),
  dismissOverlay: () => call<void>("dismiss_overlay"),
  showSettingsWindow: () => call<void>("show_settings_window"),
} as const;


export const EVENTS = {
  fixStarted: "zyntax://fix-started",
  fixCompleted: "zyntax://fix-completed",
  fixFailed: "zyntax://fix-failed",
  settingsChanged: "zyntax://settings-changed",
  updateAvailable: "zyntax://update-available",
  updateProgress: "zyntax://update-progress",
} as const;


export function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, (message) => handler(message.payload));
}
